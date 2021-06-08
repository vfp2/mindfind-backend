const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment');
const prettyBytes = require('pretty-bytes');
const express = require('express');
const { url } = require('inspector');
const AthenaExpress = require("athena-express"),
	aws = require("aws-sdk"),
	awsCredentials = {
		region: "us-east-1",
		accessKeyId: "",
		secretAccessKey: ""
	};
  aws.config.update(awsCredentials);

const app = express()
const port = 3945
const athenaExpressConfig = {
	aws,
	s3: "s3://mindfind-commoncrawl",
  getStats: true
};
const athenaExpress = new AthenaExpress(athenaExpressConfig);
const athenaDBName = "ccindex";
const medFarmApiUrl = 'http://medfarm.fp2.dev:3333/api/randuniform?deviceId=QWR4E004';
// const medFarmApiUrl = 'https://entronet.fp2.dev/api/randuniform?deviceId=QWR4E004';
const maxResultsPerPage = 10;

const getRandomUrl = async () => {
  // Get entropy
  let medResponse = await axios.get(medFarmApiUrl);
  let randomPercent = medResponse.data * 100; // convert the random [0,1) number to a %
  
  // Get a random (but potentially - hopefully - mentally influenced!) URL from Common Crawl index on AWS Athena
  let athenaResult = await athenaExpress.query({
    sql: `SELECT url_host_name,url FROM "ccindex"."ccindex" TABLESAMPLE BERNOULLI(${randomPercent}) WHERE crawl = 'CC-MAIN-2021-04' AND subset = 'warc' LIMIT 1`,
    db: athenaDBName,
    getStats: true 
  });

  // Get the URL's HTML
  let html = await axios.get(athenaResult.Items[0].url);
  console.log(athenaResult.Items[0].url);
  // console.log(html.data)
  const $ = cheerio.load(html.data);
  const title = $('meta[property="og:title"]').attr('content') || $('title').text() || $('meta[name="title"]').attr('content')
  console.log("Title:" + title);
  const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content')
  console.log("Description:" + description);
  // const url = $('meta[property="og:url"]').attr('content')
  // const site_name = $('meta[property="og:site_name"]').attr('content')
  // const image = $('meta[property="og:image"]').attr('content') || $('meta[property="og:image:url"]').attr('content')
  // const icon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href')
  // const keywords = $('meta[property="og:keywords"]').attr('content') || $('meta[name="keywords"]').attr('content')
  console.log("");

  return {
    entropy: medResponse.data,
    url: athenaResult.Items[0].url,
    hostname: athenaResult.Items[0].url_host_name,
    millisTaken: athenaResult.TotalExecutionTimeInMillis,
    bytesScanned: athenaResult.DataScannedInBytes,
    metaTitle: title,
    metaDescription: description,
  };
}

app.get('/api/geturls', async (req, res) => {
  // Get all URLs 
  var items = [];
  var allUrlResponses = await Promise.all(Array.from({length: maxResultsPerPage}, _ => getRandomUrl()));
  allUrlResponses.forEach((urlResponse) => {
    items.push({
      link: urlResponse.url,
      title: urlResponse.metaTitle,
      displayLink: urlResponse.hostname,
      snippet: urlResponse.metaDescription
    })
  });

  // Calculate time take/bytes scanned
  var totalBytesScanned = 0;
  var totalMillisTaken = 0;
  allUrlResponses.forEach((urlResponse) => {
    totalMillisTaken += urlResponse.millisTaken;
    totalBytesScanned += urlResponse.bytesScanned;
  });

  var result = {
    searchInformation: {
      formattedTotalResults: allUrlResponses.length,
      formattedTotalSizeScanned: prettyBytes(totalBytesScanned),
      formattedSearchTime: moment.utc(totalMillisTaken).format('HH:mm:ss:SSS')
    },  
    items: items
  };
  res.send(result);
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})




