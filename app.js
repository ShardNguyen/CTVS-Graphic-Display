const express = require('express');
const path = require('path');
const app = express();

// Serve everything in /public (HTML, CSS, JS, images...)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(3000, function () {
    console.log('App listening on port 3000!');
});