// Refresh the bundled money table from Box Office History, the one source
// both apps adjust dollars with (ticket prices for grosses, CPI for budgets,
// one base year). Bundled, not fetched at runtime: this PWA works offline.
//
//   yarn fetch-inflation
import { writeFileSync } from 'node:fs';

const URL = 'https://boxofficehistory.com/api/v1/inflation.json';
const res = await fetch(URL);
if (!res.ok) throw new Error(`${res.status} fetching ${URL}`);
const table = await res.json();
if (!table.baseYear || !table.ticketPrices || !table.cpi) throw new Error('unexpected shape');
writeFileSync(new URL('../src/assets/data/inflation.json', import.meta.url), `${JSON.stringify(table, null, 1)}\n`);
console.log(`inflation.json: base year ${table.baseYear}, ticket prices ${Object.keys(table.ticketPrices).length} years, CPI ${Object.keys(table.cpi).length} years`);
