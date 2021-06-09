const axios = require('axios');
const cheerio = require('cheerio');
const math = require('mathjs');
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

app.get('/api/get/intent', async (req, res) => {
  // Get the searcher's intent
  axios
    .all(Array.from({length: maxResultsPerPage}, _ => axios.get(medFarmApiUrl)))
    .then(axios.spread((... responses) => {
      let randUniforms = [];
      responses.forEach((response) => {
        randUniforms.push(response.data);
      });

      let average = math.mean(randUniforms);
      let stddev = math.std(randUniforms);

      var result = {results: []};
      randUniforms.forEach((randUniform) => {
          // z-score: z = (x – μ) / σ
          let zScore = (randUniform - average) / stddev;
          result.results.push({
            intentScore: randUniform,
            zScore: zScore
          });
      });

      result.results = result.results.sort((a, b) => {
        if (a.zScore > b.zScore)
          return 1;
        else if (a.zScore < b.zScore)
          return -1;
        
        return 0;
      }).reverse();

      res.send(result);
    })).catch(error => {
      console.log(error);
      res.send(error);
    });
});

app.get('/api/get/url', async (req, res) => {
  const getRandomUrl = async (intentScore) => {
    // Get a random (but potentially - hopefully - mentally influenced!) URL from Common Crawl index on AWS Athena
    let athenaResult = await athenaExpress.query({
      sql: `SELECT url_host_name,url FROM "ccindex"."ccindex" TABLESAMPLE BERNOULLI(${intentScore}) WHERE crawl = 'CC-MAIN-2021-04' AND subset = 'warc' LIMIT 1`,
      db: athenaDBName,
      getStats: true 
    });

    // Get the URL's HTML
    let title, description;
    try {
      let html = await axios.get(athenaResult.Items[0].url);
      console.log(athenaResult.Items[0].url);
      const $ = cheerio.load(html.data);
      title = $('meta[property="og:title"]').attr('content') || $('title').text() || $('meta[name="title"]').attr('content')
      console.log("Title:" + title);
      description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content')
      console.log("Description:" + description);
      // const url = $('meta[property="og:url"]').attr('content')
      // const site_name = $('meta[property="og:site_name"]').attr('content')
      // const image = $('meta[property="og:image"]').attr('content') || $('meta[property="og:image:url"]').attr('content')
      // const icon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href')
      // const keywords = $('meta[property="og:keywords"]').attr('content') || $('meta[name="keywords"]').attr('content')
      console.log("");
    } catch (error) {
      console.log(error);
    }

    return {
      entropy: req.query.intentScore,
      url: athenaResult.Items[0].url,
      hostname: athenaResult.Items[0].url_host_name,
      millisTaken: athenaResult.TotalExecutionTimeInMillis,
      bytesScanned: athenaResult.DataScannedInBytes,
      metaTitle: title,
      metaDescription: description,
    };
  }

  // Get all URLs 
  var items = [];
  var allUrlResponses = await Promise.all(Array.from({length: 1}, _ => getRandomUrl(req.query.intentScore)));
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
      totalResults: allUrlResponses.length,
      totalBytesScanned: totalBytesScanned,
      totalMillisTaken: totalMillisTaken
    },  
    items: items
  };
  res.send(result);
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});