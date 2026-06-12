import { Policy } from "./agents/lib/wiki_db/policy.ts";

const p = new Policy("auto", "dev");

console.log("Normal unbounded: ", p.checkQuery("SELECT * FROM users"));
console.log("Comment bounded bypass: ", p.checkQuery("SELECT * FROM users /* WHERE */"));
