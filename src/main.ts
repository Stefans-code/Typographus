/* Self-hosted fonts — bundled so the desktop app never depends on a CDN. */
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "material-symbols/rounded.css";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/screens.css";
import "./styles/document.css";

import { startApp } from "./app";

const root = document.getElementById("app");
if (root) startApp(root);
