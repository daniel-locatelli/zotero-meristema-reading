/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";

describe("Meristema Reading startup", function () {
  it("registers the plugin instance", function () {
    const instance = (Zotero as any)[config.addonInstance];
    expect(instance, "the plugin instance").to.exist;
    expect(instance.data.initialized, "initialized").to.equal(true);
  });
});
