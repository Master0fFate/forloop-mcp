import { baseCss } from "./base.js";
import { controlsCss } from "./controls.js";
import { layoutCss } from "./layout.js";
import { listsCss } from "./lists.js";
import { responsiveCss } from "./responsive.js";

export const appCss = [baseCss, layoutCss, controlsCss, listsCss, responsiveCss].join("\n");
