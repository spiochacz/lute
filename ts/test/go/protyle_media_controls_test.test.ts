// Port of test/protyle_media_controls_test.go (TestProtyleVideoControls, TestProtyleAudioControls).

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";

const count = (s: string, sub: string): number => s.split(sub).length - 1;

interface MediaCase {
  name: string;
  input: string;
  expected: string;
}

test("TestProtyleVideoControls", async (t) => {
  const l = New();
  l.SetProtyleWYSIWYG(true);
  l.SetSanitize(true);
  const tests: MediaCase[] = [
    { name: "missing", input: `<video src="assets/video.mp4"></video>`, expected: `<video src="assets/video.mp4" controls="controls"></video>` },
    { name: "existing", input: `<video controls="controls" src="assets/video.mp4"></video>`, expected: `<video controls="controls" src="assets/video.mp4"></video>` },
    { name: "boolean", input: `<video controls src="assets/video.mp4"></video>`, expected: `<video controls="" src="assets/video.mp4"></video>` },
    {
      name: "attributes",
      input: `<video src="https://example.com/video.mp4?a=1&amp;b=2" poster="assets/poster.png" muted loop></video>`,
      expected: `<video src="https://example.com/video.mp4?a=1&amp;b=2" poster="assets/poster.png" muted="" loop="" controls="controls"></video>`,
    },
    { name: "source", input: `<video><source src="assets/video.mp4" type="video/mp4"></video>`, expected: `<video controls="controls"><source src="assets/video.mp4" type="video/mp4"/></video>` },
  ];
  for (const tt of tests) {
    await t.test(tt.name, () => {
      const doms: Record<string, string> = {
        markdown: l.Md2BlockDOM(tt.input, false),
        html: l.HTML2BlockDOM(tt.input),
        "existing-block": l.SpinBlockDOM(`<div data-node-id="20260918120000-abcdefg" data-type="NodeVideo" class="iframe"><div class="iframe-content">` + tt.input + `</div></div>`),
      };
      for (const [name, dom] of Object.entries(doms)) {
        let expected = tt.expected;
        if ("source" === tt.name && "html" === name) {
          expected = `<video src="assets/video.mp4" controls="controls"></video>`;
        }
        assert.ok(dom.includes(expected), `${name}: expected ${expected} in ${dom}`);
        const spun = l.SpinBlockDOM(dom);
        assert.ok(spun.includes(expected) && count(spun, " controls=") === 1, `${name}: controls or attributes changed after round trip: ${spun}`);
      }
    });
  }
});

test("TestProtyleAudioControls", async (t) => {
  const l = New();
  l.SetProtyleWYSIWYG(true);
  l.SetSanitize(true);
  const tests: MediaCase[] = [
    { name: "missing", input: `<audio src="assets/audio.mp3"></audio>`, expected: `<audio src="assets/audio.mp3" controls="controls"></audio>` },
    { name: "existing", input: `<audio controls="controls" src="assets/audio.mp3"></audio>`, expected: `<audio controls="controls" src="assets/audio.mp3"></audio>` },
    { name: "boolean", input: `<audio controls src="assets/audio.mp3"></audio>`, expected: `<audio controls="" src="assets/audio.mp3"></audio>` },
    {
      name: "attributes",
      input: `<audio src="https://example.com/audio.mp3?a=1&amp;b=2" preload="none" muted loop></audio>`,
      expected: `<audio src="https://example.com/audio.mp3?a=1&amp;b=2" preload="none" muted="" loop="" controls="controls"></audio>`,
    },
    { name: "source", input: `<audio><source src="assets/audio.mp3" type="audio/mpeg"></audio>`, expected: `<audio controls="controls"><source src="assets/audio.mp3" type="audio/mpeg"/></audio>` },
  ];
  for (const tt of tests) {
    await t.test(tt.name, () => {
      const doms: Record<string, string> = {
        markdown: l.Md2BlockDOM(tt.input, false),
        html: l.HTML2BlockDOM(tt.input),
        "existing-block": l.SpinBlockDOM(`<div data-node-id="20260918120000-abcdefg" data-type="NodeAudio" class="iframe"><div class="iframe-content">` + tt.input + `</div></div>`),
      };
      for (const [name, dom] of Object.entries(doms)) {
        assert.ok(dom.includes(tt.expected), `${name}: expected ${tt.expected} in ${dom}`);
        const spun = l.SpinBlockDOM(dom);
        assert.ok(spun.includes(tt.expected) && count(spun, " controls=") === 1, `${name}: controls or attributes changed after round trip: ${spun}`);
      }
    });
  }
});
