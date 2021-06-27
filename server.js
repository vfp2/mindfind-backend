const axios = require('axios');
const cheerio = require('cheerio');
const math = require('mathjs');
const express = require('express');
const { url } = require('inspector');
const keys = require('./keys');
const crypto = require('crypto');
const AthenaExpress = require("athena-express"),
	aws = require("aws-sdk"),
	awsCredentials = {
		region: "us-east-1",
		accessKeyId: keys.awsAccessKeyId,
		secretAccessKey: keys.awsSecretAccessKey
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
  // Implement Scott Wilber's multi-stage MMI index generator algorithm to get an index in the 3.4 billion
  // Common Crawl's URL index of all crawled URLs on the web.
  // https://forum.fp2.dev/t/collaborative-project-idea-mindfind-mental-google-search/62/17

  let nl = 9; // Number of Lines multiplier
  let N = 5185; // number of steps in a random walk per stage: (8 * nl)^2 +1 to make the number odd
  let numStages = 10;
  let entropyBytesLen = math.ceil((N * numStages)/8); // byte size of total number of MMI bits to get from the QRNG
  let stddev = math.sqrt(N);
  let resolution = 3401286407; // total number of crawled URLs to find an index in

  axios
  .get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4E002&length=${entropyBytesLen}`, {responseType: 'arraybuffer'})
  .then(response => {
    let totalEntropy = bitarray.fromBuffer(response.data);
    console.log("total num bits: " + totalEntropy.length);
    console.log("total num ones: " + totalEntropy.bitcount());
    console.log("N: " + N);

    // Bit at a time, count the number of 1 bits per stage
    let numOnesPerStage = new Array(numStages).fill(0);
    let stage = 0;
    for (let i = 0; i < totalEntropy.length - 1; i++) {
      if (totalEntropy.get(i) === 1) {
        numOnesPerStage[stage] = numOnesPerStage[stage] + 1; 
        console.log(numOnesPerStage[stage]);
      }
      if (stage < numStages - 1) {
        stage++;
      } else {
        stage = 0;
      }
    }

    ps = [];
    for (let j = 0; j < numStages; j++) {
      let numOnes = numOnesPerStage[j];

      // Calculate the terminal points' coordinates in random walk
      // 𝐶𝑇 =(2 × 𝑜𝑛𝑒𝑠)−𝑁
      let ct = (2 * numOnes) - N;

      // Calculate z-score for the terminal coordinate
      // standard deviation (SD) = √𝑁
      // 𝑧 − 𝑠𝑐𝑜𝑟𝑒𝑠 = (𝑥, 𝑦)/√𝑁
      let z = ct / stddev;

      // Calculate the cumulative normal distribution probabilities (p) from z-score
      // (The z-scores of each coordinate can be converted to uniform variates by a simple inverse approximation.)
      let p = linearize(z);
      ps[j] = p;
    }
  
    // Generate the index
    let index = 0;
    for (let k = 0, l = 9; k < numStages; k++, l--) {
      index += math.pow(nl, l) * math.floor(nl * ps[k]);
    }

    // Interpolate
    // interpolated index = Floor[3.464 x 10^9 * index/(nl^10)
    let interpolatedIdx = math.floor(resolution * index/math.pow(nl, numStages));
    console.log("interpolatedIdx: " + interpolatedIdx);
    res.send({index: interpolatedIdx});
  }).catch(error => {
    console.log(error);
    res.send(error);
  });

  // const getRandomUrl = async (intentScore) => {
  //   // Get a random (but potentially - hopefully - mentally influenced!) URL from Common Crawl index on AWS Athena
  //   let athenaResult = await athenaExpress.query({
  //     sql: `SELECT url_host_name,url FROM "ccindex"."ccindex" TABLESAMPLE BERNOULLI(${intentScore}) WHERE crawl = 'CC-MAIN-2021-04' AND subset = 'warc' LIMIT 1`,
  //     db: athenaDBName,
  //     getStats: true 
  //   });

  //   // Get the URL's HTML
  //   let title, description;
  //   try {
  //     let html = await axios.get(athenaResult.Items[0].url);
  //     console.log(athenaResult.Items[0].url);
  //     const $ = cheerio.load(html.data);
  //     title = $('meta[property="og:title"]').attr('content') || $('title').text() || $('meta[name="title"]').attr('content')
  //     console.log("Title:" + title);
  //     description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content')
  //     console.log("Description:" + description);
  //     // const url = $('meta[property="og:url"]').attr('content')
  //     // const site_name = $('meta[property="og:site_name"]').attr('content')
  //     // const image = $('meta[property="og:image"]').attr('content') || $('meta[property="og:image:url"]').attr('content')
  //     // const icon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href')
  //     // const keywords = $('meta[property="og:keywords"]').attr('content') || $('meta[name="keywords"]').attr('content')
  //     console.log("");
  //   } catch (error) {
  //     console.log(error);
  //   }

  //   return {
  //     entropy: req.query.intentScore,
  //     url: athenaResult.Items[0].url,
  //     hostname: athenaResult.Items[0].url_host_name,
  //     millisTaken: athenaResult.TotalExecutionTimeInMillis,
  //     bytesScanned: athenaResult.DataScannedInBytes,
  //     metaTitle: title,
  //     metaDescription: description,
  //   };
  // }

  // // Get all URLs 
  // var items = [];
  // var allUrlResponses = await Promise.all(Array.from({length: 1}, _ => getRandomUrl(req.query.intentScore)));
  // allUrlResponses.forEach((urlResponse) => {
  //   items.push({
  //     link: urlResponse.url,
  //     title: urlResponse.metaTitle,
  //     displayLink: urlResponse.hostname,
  //     snippet: urlResponse.metaDescription
  //   })
  // });

  // // Calculate time take/bytes scanned
  // var totalBytesScanned = 0;
  // var totalMillisTaken = 0;
  // allUrlResponses.forEach((urlResponse) => {
  //   totalMillisTaken += urlResponse.millisTaken;
  //   totalBytesScanned += urlResponse.bytesScanned;
  // });

  // var result = {
  //   searchInformation: {
  //     totalResults: allUrlResponses.length,
  //     totalBytesScanned: totalBytesScanned,
  //     totalMillisTaken: totalMillisTaken
  //   },  
  //   items: items
  // };
  // res.send(result);
});

function linearize(x) {
  // constants
  let c1 = 2.506628275;
  let c2 = 0.31938153;
  let c3 = -0.356563782;
  let c4 = 1.781477937;
  let c5 = -1.821255978;
  let c6 = 1.330274429;
  let c7 = 0.2316419;

  // Save the sign of x
  let sign = 1;
  if (x < 0) {
      sign = -1;
  }

  let t = 1 + c7 * sign * x;
  let cdf = 0.5 + sign * (0.5 - (c2 + (c6 + c5*t + c4*math.pow(t, 2) + c3*math.pow(t, 3) )/ Math.pow(t, 4)) / (c1*math.exp(0.5*x*x) * t));

  return cdf;
}

app.get('/api/get/searchterms', async (req, res) => {
  let N = 16384;
  let entropyBytesLen = N*2/8;
  let stddev = math.sqrt(N);
  let mm = 32

  postProcess = (... responses) => {
    // Get the number of 1 bits detected by each generator
    // ones ~= 32,768 (2^15)
    let coarseOnes = [];
    let fineOnes = [];
    responses.forEach((response) => {
      let bits = bitarray.fromBuffer(response.data);
      let coarseNumOnes = 0;
      let fineNumOnes = 0;
      for (let i = 0; i < bits.length; i++) {
        if (i % 2 == 0) {
          if (bits.get(i) === 1) coarseNumOnes++;
        } else {
          if (bits.get(i) === 1) fineNumOnes++;
        }
      }
      coarseOnes.push(coarseNumOnes);
      fineOnes.push(fineNumOnes);
    });

    // Calculate the terminal points' coordinates in each random walk
    let coarseCts = [];
    coarseOnes.forEach((numOnes) => {
      // 𝐶𝑇 =(2 × 𝑜𝑛𝑒𝑠)−𝑁
      let ct = (2 * numOnes) - N;
      coarseCts.push(ct);
    });
    let fineCts = [];
    fineOnes.forEach((numOnes) => {
      // 𝐶𝑇 =(2 × 𝑜𝑛𝑒𝑠)−𝑁
      let ct = (2 * numOnes) - N;
      fineCts.push(ct);
    });

    // Calculate z-scores for each terminal coordinate
    // standard deviation (SD) = √𝑁
    let coarseZscores = [];
    coarseCts.forEach((ct) => {
      // 𝑧 − 𝑠𝑐𝑜𝑟𝑒𝑠 = (𝑥, 𝑦)/√𝑁
      let z = ct / stddev;
      coarseZscores.push(z);
    });
    let fineZscores = [];
    fineCts.forEach((ct) => {
      // 𝑧 − 𝑠𝑐𝑜𝑟𝑒𝑠 = (𝑥, 𝑦)/√𝑁
      let z = ct / stddev;
      fineZscores.push(z);
    });

    // Calculate the cumulative normal distribution probabilities (p) from each z-score
    // (The z-scores of each coordinate can be converted to uniform variates by a simple inverse approximation.)
    coarsePs = [];
    coarseZscores.forEach((z) => {
      coarsePs.push(linearize(z));
    });
    finePs = [];
    fineZscores.forEach((z) => {
      finePs.push(linearize(z));
    });

    let indxs = [];
    for (let i = 0; i < coarseOnes.length; i++) {
      let linearizedProbability = (mm * math.floor(mm * coarsePs[i])) + math.floor(mm * finePs[i]);
      indxs.push(linearizedProbability);
    }

    // res.redirect(`https://google.com/search?q=${words[indxs[0]]}%20${words[indxs[1]]}%20${words[indxs[2]]}%20${words[indxs[3]]}`);
    res.redirect(`https://google.com/search?q=${words[indxs[0]]}%20${words[indxs[1]]}%20${words[indxs[2]]}`);
    // res.send({indicies: indxs,
    //     words: [
    //       words[indxs[0]],
    //       words[indxs[1]],
    //       words[indxs[2]],
    //       // words[indxs[3]]
    //   ]
    // });
  };

  if (req.query.pseudo) {
    const buf1 = Buffer.alloc(entropyBytesLen);
    crypto.randomFill(buf1, (err, buf) => {
      const buf2 = Buffer.alloc(entropyBytesLen);
      crypto.randomFill(buf2, (err, buf) => {
        const buf3 = Buffer.alloc(entropyBytesLen);
        crypto.randomFill(buf3, (err, buf) => {
          // const buf4 = Buffer.alloc(entropyBytesLen);
          // crypto.randomFill(buf4, (err, buf) => {
            var responses = [
              { data: buf1},
              { data: buf2},
              { data: buf3},
              // { data: buf4}
            ];
            postProcess(responses[0], responses[1], responses[2]);
            // postProcess(responses[0], responses[1], responses[2], responses[3]);
          // });
        });
      });
    });
  } else {
    var gets = [
      axios.get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4E001&length=${entropyBytesLen}`, {responseType: 'arraybuffer'}),
      axios.get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4E002&length=${entropyBytesLen}`, {responseType: 'arraybuffer'}),
      axios.get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4E004&length=${entropyBytesLen}`, {responseType: 'arraybuffer'}),
      // axios.get(`http://medfarm.fp2.dev:3333/api/randbytes?deviceId=QWR4X003&length=${entropyBytesLen}`, {responseType: 'arraybuffer'})
    ];
    axios
    .all(gets)
    .then(axios.spread((... responses) => {
      postProcess(...responses);
    })).catch(error => {
      console.log(error);
      res.send(error);
    });
  }
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});