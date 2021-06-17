const commoncrawl = require('commoncrawl');
// commoncrawl.getIndex().then((data) => {
//   console.log(data);
// });
commoncrawl.searchURL('example.com')
    .then((data) => {
        console.log(data);
    });