import { Link } from "react-router-dom";
export function FontPreview() {
  const base = import.meta.env.BASE_URL + "assets/font-previews/";
  return (
    <>
      <style>{`@font-face{font-family:AssistantSerifPreview;src:url("${base}serif.woff2") format("woff2");font-display:swap;}@font-face{font-family:AssistantWenkaiPreview;src:url("${base}wenkai.woff2") format("woff2");font-display:swap;}.font-options{display:grid;gap:20px}.font-candidate{padding:24px;background:#fff9f5;border:1px solid #c3a878;border-radius:12px;color:#4d3455}.font-candidate h2{margin-bottom:18px}.font-candidate p{font:inherit;line-height:2;color:inherit}.font-sample-title{font-size:24px}.font-sample-dialogue{font-size:20px}.font-candidate button{background:#54335f;color:#fff1d9;border:1px solid #bc9d69;border-radius:6px;padding:10px 20px}`}</style>
      <div className="page-title">
        <div>
          <h1>字体候选预览</h1>
          <p>已采用 A 思源宋体作为全局字体。此处保留两款样例，供对照查看。</p>
        </div>
      </div>
      <div className="font-options">
        {[
          {
            id: "A",
            name: "思源宋体 · 优雅克制",
            font: "AssistantSerifPreview",
            detail: "宋体标题与对话统一，适合安静、专业的私人秘书。",
          },
          {
            id: "B",
            name: "霞鹜文楷 · 温柔书写",
            font: "AssistantWenkaiPreview",
            detail:
              "手写气息较强，适合温柔、文学感的对话；标题可继续搭配宋体。",
          },
        ].map((option) => (
          <section className="font-candidate" key={option.id}>
            <h2>
              {option.id} · {option.name}
            </h2>
            <p style={{ fontSize: 12 }}>{option.detail}</p>
            <div style={{ fontFamily: `${option.font},serif` }}>
              <div className="font-sample-title">律 · 私人特助</div>
              <p className="font-sample-dialogue">
                总裁，今日最重要的事务已为您整理妥当。预计需要两小时，现在开始吗？
              </p>
              <p>2026年11月10日　MY PRIVATE ASSISTANT</p>
              <button style={{ fontFamily: "inherit" }}>与律交谈</button>
            </div>
          </section>
        ))}
      </div>
      <p>
        仅包含本页示例文字：思源宋体约 43 KB，霞鹜文楷约 23 KB。A
        已另行制作完整字符覆盖的 Unicode
        分包，本地加载并提供系统回退；此处的样例子集仅用于对比。
      </p>
      <p>
        字体来自{" "}
        <a href="https://github.com/adobe-fonts/source-han-serif">
          Adobe 思源宋体
        </a>{" "}
        与 <a href="https://github.com/lxgw/LxgwWenKai">LXGW 霞鹜文楷</a>
        ，均随预览文件保留 OFL 许可。
      </p>
      <Link to="/">返回律的书房</Link>
    </>
  );
}
