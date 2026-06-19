const lines = Array.from({ length: 100000 }, (_, i) => `{"ts":"2026-05-21T12:00:00+00:00","op":"atlas","cost":${i}}`);
console.time("inline .match");
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^{"ts":"([^"\\]+)"/);
}
console.timeEnd("inline .match");

const TS_REGEX = /^{"ts":"([^"\\]+)"/;
console.time("hoisted .exec");
for (let i = 0; i < lines.length; i++) {
  const m = TS_REGEX.exec(lines[i]);
}
console.timeEnd("hoisted .exec");
