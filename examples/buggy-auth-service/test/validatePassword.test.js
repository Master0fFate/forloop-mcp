import assert from "node:assert/strict";
import { validatePassword } from "../src/validatePassword.js";

assert.equal(validatePassword(undefined), false);
assert.equal(validatePassword(""), false);
assert.equal(validatePassword("   "), false);
assert.equal(validatePassword("correct horse battery staple"), true);

console.log("validatePassword tests passed");
