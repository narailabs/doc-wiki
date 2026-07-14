const fs = require("fs");

function iterateForward(raw) {
  let prevIdx = -1;
  let lines = [];
  while (true) {
    let nextIdx = raw.indexOf('\n', prevIdx + 1);
    const rawLine = nextIdx === -1 ? raw.substring(prevIdx + 1) : raw.substring(prevIdx + 1, nextIdx);
    prevIdx = nextIdx;

    const line = rawLine.trim();
    if (!line && nextIdx === -1) break;
    if (!line) continue;

    lines.push(line);

    if (nextIdx === -1) break;
  }
  return lines;
}

const lines = ["a", "b", "c"];
console.log(iterateForward(lines.join("\n"))); // ["a", "b", "c"]
console.log(iterateForward("")); // []
const lines2 = ["a", "b", "c", ""];
console.log(iterateForward(lines2.join("\n"))); // ["a", "b", "c"]
