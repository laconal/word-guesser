import React from "react";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "./styles.css";
import App from "./App";
import { I18nProvider } from "./lib/i18n";

const theme = createTheme({
  primaryColor: "violet",
  defaultRadius: "md",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  headings: { fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <I18nProvider>
        <App />
      </I18nProvider>
    </MantineProvider>
  </React.StrictMode>,
);
