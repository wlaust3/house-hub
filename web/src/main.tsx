import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { t } from "./i18n";
import "./styles.css";

type Role = "housekeeper" | "family";

function App() {
  const [role, setRole] = useState<Role | null>(
    () => localStorage.getItem("role") as Role | null,
  );
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => setOnline(r.ok))
      .catch(() => setOnline(false));
  }, []);

  const pick = (r: Role) => {
    localStorage.setItem("role", r);
    setRole(r);
  };

  return (
    <main>
      <h1>{t("app.title")}</h1>
      {role === null ? (
        <>
          <h2>{t("who.question")}</h2>
          <button className="big" onClick={() => pick("housekeeper")}>
            {t("who.housekeeper")}
          </button>
          <button className="big alt" onClick={() => pick("family")}>
            {t("who.family")}
          </button>
        </>
      ) : (
        <>
          <h2>{t("app.tagline")}</h2>
          <p>{t("home.placeholder")}</p>
        </>
      )}
      <p className={online === false ? "status bad" : "status"}>
        {online === null ? "" : online ? t("status.server.ok") : t("status.server.down")}
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
