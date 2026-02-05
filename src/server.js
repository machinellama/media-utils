// server.js
const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');

const app = express();
const upload = multer({ dest: os.tmpdir() });

const spliceRoute = require('./routes/splice')(upload);
const combineRoute = require('./routes/combine')(upload);


app.use('/splice', spliceRoute);
app.use('/combine', combineRoute);

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server listening on ${port}`));
