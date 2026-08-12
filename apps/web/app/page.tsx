// Placeholder landing page. The real admin UI (docs/06-admin.md) is a
// separate, large piece of work not yet built — see README "現状" section.
export default function HomePage() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Popup Tool</h1>
      <p>管理画面は未実装です。動作確認用のエンドポイント:</p>
      <ul>
        <li>
          <code>GET /c/SITE_PRIMEDIRECT.json</code> — 配信設定
        </li>
        <li>
          <code>POST /e</code> — 計測イベント収集
        </li>
      </ul>
    </main>
  );
}
