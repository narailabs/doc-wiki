import { main as buildImage } from "./build_image.js";
import { main as buildWiki } from "./build_wiki.js";
import { main as grade } from "./grade.js";
import { main as mine } from "./mine_tickets.js";
import { main as report } from "./report.js";
import { main as run } from "./run_ticket.js";
const USAGE = "usage: npm run benchmark -- <mine|build-image|build-wiki|calibrate|run|grade|report> [flags]\n";
export async function dispatch(argv) {
    const [sub, ...rest] = argv;
    switch (sub) {
        case "mine": return mine(rest);
        case "build-image": return buildImage(rest);
        case "build-wiki": return buildWiki(rest);
        case "calibrate": return grade(["calibrate", ...rest]);
        case "grade": return grade(["grade", ...rest]);
        case "run": return run(rest);
        case "report": return report(rest);
        default:
            process.stderr.write(USAGE);
            return 2;
    }
}
const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) {
    dispatch(process.argv.slice(2)).then((code) => process.exit(code));
}
