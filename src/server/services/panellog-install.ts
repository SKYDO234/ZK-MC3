/**
 * Installed as the first import in server.ts so every later module's console
 * output is captured, regardless of ESM evaluation order.
 */
import { installLogCapture } from "./panellog";

installLogCapture();
