-- Lets a creative's click either navigate to a URL (the existing behavior)
-- or simply close the popup, returning the visitor to the page they were
-- already on ("元のページに戻る" — e.g. a banner shown on browser-back that
-- should behave like the × close button, not send the visitor elsewhere).
ALTER TABLE creatives
  ADD COLUMN link_action TEXT NOT NULL DEFAULT 'url' CHECK (link_action IN ('url','close')),
  ALTER COLUMN link_url DROP NOT NULL;

ALTER TABLE creatives
  ADD CONSTRAINT creatives_link_url_required_for_url_action
  CHECK (link_action <> 'url' OR link_url IS NOT NULL);
