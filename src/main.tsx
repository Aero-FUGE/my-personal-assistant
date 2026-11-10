import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";
import "./chat.css";
import "./typography.css";
const update = registerSW({
  immediate: true,
  onNeedRefresh() {
    const bar = document.createElement("button");
    bar.className = "update-banner";
    bar.textContent = "新版本已就绪 · 点击更新（请先保存编辑）";
    bar.onclick = () => {
      void update(true);
    };
    document.body.appendChild(bar);
  },
  onRegisterError(error) {
    console.warn("离线缓存注册失败", error);
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
