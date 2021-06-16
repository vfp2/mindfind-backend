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
const bitarray = require('node-bitarray');

const app = express()
const port = 3945
const athenaExpressConfig = {
	aws,
	s3: "s3://mindfind-commoncrawl",
  getStats: true
};
const athenaExpress = new AthenaExpress(athenaExpressConfig);
const athenaDBName = "ccindex";
const medFarmUniformEndpoint = 'http://medfarm.fp2.dev:3333/api/randuniform?deviceId=QWR4E004';
// const medFarmUniformEndpoint = 'https://entronet.fp2.dev/api/randuniform?deviceId=QWR4E004';
const maxResultsPerPage = 10;

const words = require('fs').readFileSync('words/1024words.txt', 'utf-8').toString().split("\n");

app.get('/api/get/intent', async (req, res) => {
  // Get the searcher's intent
  axios
    .all(Array.from({length: maxResultsPerPage}, _ => axios.get(medFarmUniformEndpoint)))
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

app.get('/api/get/searchterms', async (req, res) => {
  // QWR4Exxx devices are 101x amplified @ 100 KHz.
  // Get 65,536 bits (8,192 bytes) of entropy, ~0.66 seconds.
  // 3 MEDs, 3 resulting search terms.
  // N = 65,536 (2^16)
  let N = 65536;
  let stddev = math.sqrt(N);
  let n = 4*stddev;
  // n = 1024 (range of output integers)
  var gets = [
    axios.get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4E001&length=${N/8}`, {responseType: 'arraybuffer'}),
    axios.get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4E002&length=${N/8}`, {responseType: 'arraybuffer'}),
    axios.get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4E004&length=${N/8}`, {responseType: 'arraybuffer'})
  ];

  axios
  .all(gets)
  .then(axios.spread((... responses) => {
    // Get the number of 1 bits detected by each generator
    // ones ~= 32,768 (2^15)
    let ones = [];
    responses.forEach((response) => {
      let numOnes = bitarray.fromBuffer(response.data).bitcount();
      ones.push(numOnes);
    });

    // Calculate the terminal points' coordinates in each random walk
    let cts = []; 
    ones.forEach((numOnes) => {
      // 𝐶𝑇 =(2 × 𝑜𝑛𝑒𝑠)−𝑁
      let ct = (2 * numOnes) - N;
      cts.push(ct);
    });

    // Calculate z-scores for each terminal coordinate
    // standard deviation (SD) = √𝑁
    let zscores = [];
    cts.forEach((ct) => {
      // 𝑧 − 𝑠𝑐𝑜𝑟𝑒𝑠 = (𝑥, 𝑦)/√𝑁
      let z = ct / stddev;
      zscores.push(z);
    });

    // Calculate the cumulative normal distribution probabilities (p) from each z-score
    // (The z-scores of each coordinate can be converted to uniform variates by a simple inverse approximation.)
    ps = [];
    zscores.forEach((z) => {
      //p.push(cdf(...));
      
      // constants
      let a1 = 0.254829592;
      let a2 = -0.284496736;
      let a3 = 1.421413741;
      let a4 = -1.453152027;
      let a5 = 1.061405429;
      let p = 0.3275911;
          
      // Save the sign of z
      let sign = 1;
      if (z < 0) {
          sign = -1;
      }
      z = math.abs(z) / math.sqrt(2.0);
          
      // A&S formula 7.1.26
      let t = 1.0 / (1.0 + p*z);
      let y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * math.exp(-z*z);

      ps.push(0.5 * (1.0 + sign*y));
    });

    let indxs = [];
    ps.forEach((p) => {
      let indx = math.round(n * p);
      indxs.push(indx);
    });

    res.redirect(`https://google.com/search?q=${words[indxs[0]]}%20${words[indxs[1]]}%20${words[indxs[2]]}`);
    // res.send({indicies: indxs,
    //     words: [
    //       words[indxs[0]],
    //       words[indxs[1]],
    //       words[indxs[2]],
    //   ]
    // });
  })).catch(error => {
    console.log(error);
    res.send(error);
  });
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});