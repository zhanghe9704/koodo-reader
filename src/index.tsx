import React from "react";
import ReactDOM from "react-dom";
import "./assets/styles/reset.css";
import "./assets/styles/global.css";
import "./assets/styles/style.css";
import { Provider } from "react-redux";
import "./i18n";
import store from "./store";
import Router from "./router/index";
import StyleUtil from "./utils/reader/styleUtil";
import { initSystemFont, initTheme } from "./utils/reader/launchUtil";
import { ConfigService } from "./assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";

const DEFAULT_STORAGE_PATH = "/BookReader/Koodo";
if (!isElectron) {
  ConfigService.setItem("storageLocation", DEFAULT_STORAGE_PATH);
  ConfigService.setReaderConfig("storageLocation", DEFAULT_STORAGE_PATH);
  ConfigService.setReaderConfig("localDirectoryName", "BookReader/Koodo");
  ConfigService.setReaderConfig("isUseLocal", "yes");
}
initTheme();
initSystemFont();
ReactDOM.render(
  <Provider store={store}>
    <Router />
  </Provider>,
  document.getElementById("root")
);
StyleUtil.applyTheme();
