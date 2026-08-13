import { isHoldout, matchesTargets, pickCreative, resolvePageGroup, type CampaignConfig, type CreativeConfig, type SiteConfig } from "@popup/shared";
import { findAttributionTouch } from "./attribution.js";
import { sendEvents } from "./collector.js";
import { detectDevice } from "./device.js";
import { isEligibleByFrequency, localDayKey, recordClick, recordClose, recordShow, type FrequencyState, INITIAL_FREQUENCY_STATE } from "./frequency.js";
import { renderPopup } from "./render.js";
import { addTouch, getFrequencyState, getOrCreateSession, getOrCreateVisitorId, getTouches, setFrequencyState, uuid } from "./storage.js";
import { registerTriggers } from "./triggers.js";

// Config JSON doesn't (yet) transmit the per-site CV attribution windows —
// see docs/04-api.md 1.1's example, which only carries campaign-level
// settings. Hardcoding the documented defaults (docs/03-data-model.md
// sites.cv_click_window_days/cv_view_window_days) here is a known Phase 1
// gap; wiring per-site overrides through is Phase 2 work.
const DEFAULT_CV_CLICK_WINDOW_DAYS = 7;
const DEFAULT_CV_VIEW_WINDOW_DAYS = 1;

async function main() {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (!currentScript) return;

  const src = currentScript.getAttribute("src") || "";
  const scriptUrl = new URL(src, location.href);
  const siteId = scriptUrl.searchParams.get("sid");
  if (!siteId) return;

  const configBase = src.replace(/\/sdk\.js(\?.*)?$/, "");
  const configUrl = `${configBase}/c/${encodeURIComponent(siteId)}.json`;

  const res = await fetch(configUrl, { credentials: "omit" });
  if (!res.ok) return;
  const config: SiteConfig = await res.json();

  const now = Date.now();
  const device = detectDevice(navigator.userAgent);
  const visitorId = getOrCreateVisitorId();
  const session = getOrCreateSession(now);
  const path = location.pathname;
  const pageGroup = resolvePageGroup(config.pageGroups, path);

  installConversionQueue(config, visitorId);

  const candidates = config.campaigns
    .filter((c) => c.devices.includes(device))
    .filter((c) => matchesTargets(c.targets.urls, path))
    .filter((c) => c.creatives.length > 0)
    .filter((c) => {
      const freq = getFrequencyState(c.id) ?? INITIAL_FREQUENCY_STATE;
      return isEligibleByFrequency(freq, c.frequency, now, session.id, localDayKey(new Date(now)));
    });

  if (candidates.length === 0) return;
  const campaign = candidates.reduce((best, c) => (c.priority < best.priority ? c : best));

  if (isHoldout(session.id, campaign.id, campaign.holdoutRate)) {
    sendEvents(config.endpoints.collect, config.site.id, config.v, [
      {
        id: uuid(),
        t: "holdout",
        ts: now,
        cid: campaign.id,
        pg: pageGroup?.id,
        dev: device,
        vid: visitorId,
        sesid: session.id,
      },
    ]);
    return;
  }

  const creative = pickCreative(session.id, campaign.id, campaign.creatives);
  if (!creative) return;

  preloadImage(device === "pc" ? creative.images.pc.fallback : creative.images.sp.fallback);

  registerTriggers(campaign.triggers, session.startedAt, (triggerType) => {
    showPopup(config, campaign, creative, device, pageGroup?.id, visitorId, session.id, triggerType);
  });
}

function showPopup(
  config: SiteConfig,
  campaign: CampaignConfig,
  creative: CreativeConfig,
  device: ReturnType<typeof detectDevice>,
  pageGroupId: number | undefined,
  visitorId: string,
  sessionId: string,
  triggerType: string
) {
  const host = document.createElement("div");
  host.style.all = "initial";
  document.body.appendChild(host);

  renderPopup(host, {
    creative,
    device,
    positionPc: campaign.render.positionPc,
    positionSp: campaign.render.positionSp,
    overlay: campaign.render.overlay,
    closeButton: campaign.render.closeButton,
    onVisible: () => {
      const now = Date.now();
      addTouch({ cid: campaign.id, crid: creative.id, type: "view", ts: now, pg: pageGroupId });
      persistFrequency(campaign.id, (state) => recordShow(state, now, sessionId, localDayKey(new Date(now))));
      sendEvents(config.endpoints.collect, config.site.id, config.v, [
        {
          id: uuid(),
          t: "imp",
          ts: now,
          cid: campaign.id,
          crid: creative.id,
          url: location.href,
          pg: pageGroupId,
          dev: device,
          pos: device === "pc" ? campaign.render.positionPc : campaign.render.positionSp,
          trg: triggerType,
          vid: visitorId,
          sesid: sessionId,
        },
      ]);
    },
    onClick: () => {
      const now = Date.now();
      addTouch({ cid: campaign.id, crid: creative.id, type: "click", ts: now, pg: pageGroupId });
      persistFrequency(campaign.id, (state) => recordClick(state, now));
      sendEvents(config.endpoints.collect, config.site.id, config.v, [
        {
          id: uuid(),
          t: "click",
          ts: now,
          cid: campaign.id,
          crid: creative.id,
          url: location.href,
          pg: pageGroupId,
          dev: device,
          vid: visitorId,
          sesid: sessionId,
        },
      ]);
    },
    onClose: () => {
      const now = Date.now();
      persistFrequency(campaign.id, (state) => recordClose(state, now));
      sendEvents(config.endpoints.collect, config.site.id, config.v, [
        { id: uuid(), t: "close", ts: now, cid: campaign.id, crid: creative.id, vid: visitorId, sesid: sessionId },
      ]);
    },
  });
}

function persistFrequency(campaignId: number, update: (state: FrequencyState) => FrequencyState) {
  const current = getFrequencyState(campaignId) ?? INITIAL_FREQUENCY_STATE;
  setFrequencyState(campaignId, update(current));
}

function preloadImage(url: string) {
  if (!url) return;
  const img = new Image();
  img.src = url;
  img.decode?.().catch(() => {});
}

/**
 * Installs the `window.pqz` conversion handler (docs/09-cart-integration.md
 * 3.2's `pqz.push(['conversion', {...}])` tag) and flushes anything queued
 * before the SDK finished loading. The `page`/`consent` commands from
 * earlier design iterations are intentionally not handled — product
 * identification moved to the CV tag's `items` array
 * (docs/09-cart-integration.md 4.1), so there's nothing for a page-level
 * command to do in Phase 1.
 */
function installConversionQueue(config: SiteConfig, visitorId: string) {
  const w = window as any;
  const existing: unknown[] = Array.isArray(w.pqz) ? w.pqz : [];

  function handle(cmd: unknown) {
    if (!Array.isArray(cmd) || cmd[0] !== "conversion") return;
    const payload = cmd[1] as {
      orderId?: string;
      customerId?: string;
      revenueExTax?: number;
      items?: { code: string; qty: number; revenueExTax: number }[];
    };
    if (!payload?.orderId) return;

    const now = Date.now();
    const touch = findAttributionTouch(getTouches(), now, DEFAULT_CV_CLICK_WINDOW_DAYS, DEFAULT_CV_VIEW_WINDOW_DAYS);

    sendEvents(config.endpoints.collect, config.site.id, config.v, [
      {
        id: uuid(),
        t: "cv",
        ts: now,
        vid: visitorId,
        orderId: payload.orderId,
        customerId: payload.customerId,
        revenueExTax: payload.revenueExTax,
        items: payload.items ?? [],
        touch: touch ? { cid: touch.cid, crid: touch.crid, type: touch.type, ts: touch.ts, pg: touch.pg } : undefined,
      },
    ]);
  }

  for (const cmd of existing) handle(cmd);
  w.pqz = { push: handle };
}

main().catch(() => {
  // swallow — an SDK failure must never surface on the host page.
  // See docs/02-architecture.md 8.
});
