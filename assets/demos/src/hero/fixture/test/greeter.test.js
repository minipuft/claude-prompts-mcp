import { test } from "node:test";
import assert from "node:assert/strict";
import { greet, greetAll } from "../src/greeter.js";

test("greet trims and capitalises the name", () => {
  assert.equal(greet("  ada "), "Hello, Ada!");
});

test("greet falls back to 'friend' for an empty name", () => {
  assert.equal(greet(""), "Hello, friend!");
});

test("greetAll greets each name on its own line", () => {
  assert.equal(greetAll(["ada", "grace"]), "Hello, Ada!\nHello, Grace!");
});
