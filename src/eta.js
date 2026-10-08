// Età dell'hardware: soglie in anni (modificabili con ETA_ATTENZIONE / ETA_SOSTITUIRE) e livello di una data età.
const ATTENZIONE = Number(process.env.ETA_ATTENZIONE) > 0 ? Number(process.env.ETA_ATTENZIONE) : 4;
const SOSTITUIRE = Number(process.env.ETA_SOSTITUIRE) > ATTENZIONE ? Number(process.env.ETA_SOSTITUIRE) : ATTENZIONE + 2;
// espressione SQL dell'età in anni (decimale) a partire da una colonna data; NULL se la data manca
const sqlEta = (col) => `((current_date - ${col}) / 365.25)`;
// filtro ?eta=att|sost -> soglia in anni (altri valori ignorati)
const soglia = (v) => (v === 'att' ? ATTENZIONE : v === 'sost' ? SOSTITUIRE : null);
// 'sost' | 'att' | 'ok' | null (senza data). Solo per i computer: telefoni e monitor non hanno queste soglie
const livello = (eta) => (eta === null || eta === undefined ? null : eta >= SOSTITUIRE ? 'sost' : eta >= ATTENZIONE ? 'att' : 'ok');
const COMPUTER = ['PC', 'Mac', 'Server'];
module.exports = { ATTENZIONE, SOSTITUIRE, sqlEta, soglia, livello, COMPUTER };
