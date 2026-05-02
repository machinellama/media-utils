// server.js
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.use(express.json({ limit: '12mb' }));

const spliceRoute = require('./routes/splice')(upload);
const combineRoute = require('./routes/combine')(upload);
const watchRoute = require('./routes/watch')(upload);
const viewRoute = require('./routes/view')();
const subtitlesRoute = require('./routes/subtitles')();
const explorerRoute = require('./routes/explorer')();

app.use('/splice', spliceRoute);
app.use('/combine', combineRoute);
app.use('/watch', watchRoute);
app.use('/view', viewRoute);
app.use('/subtitles', subtitlesRoute);
app.use('/explorer', explorerRoute);

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server listening on ${port}`));
