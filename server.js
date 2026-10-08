const path = require('path');

const { caricaEnv } = require('./src/env');

const trovato = caricaEnv(path.join(__dirname, '.env'));
console.log(`.env ${trovato ? 'caricato' : 'NON trovato'} (${path.join(__dirname, '.env')}), Node ${process.version}`);

const { creaApp } = require('./src/app');

const port = process.env.PORT || 3000;
creaApp().listen(port, () => console.log(`Inventario in ascolto su :${port}`));
