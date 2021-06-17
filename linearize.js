const math = require('mathjs');
const bitarray = require('node-bitarray');

let responses = [
    {data: Array.from({length: 8192}, _ => 1)}
];

let N = 65536;
let stddev = math.sqrt(N);
let n = 4*stddev;
// n = 1024 (range of output integers)

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
    // let ct = (2 * numOnes) - N;

    // hardcode Ct for test
    let ct = 416;
    // 416 = (2 * numOnes) - N;
    // 416 + N = 2 * numOnes;
    // numOnes = (416 + N)/2

    console.log(`Ct ${ct}`);
    cts.push(ct);
});

// Calculate z-scores for each terminal coordinate
// standard deviation (SD) = √𝑁
let zscores = [];
cts.forEach((ct) => {
    // 𝑧 − 𝑠𝑐𝑜𝑟𝑒𝑠 = (𝑥, 𝑦)/√𝑁
    let z = ct / stddev;
    console.log(`z-score ${z}`);
    zscores.push(z);
});

// Calculate the cumulative normal distribution probabilities (p) from each z-score
// (The z-scores of each coordinate can be converted to uniform variates by a simple inverse approximation.)
ps = [];
zscores.forEach((z) => {
    let x = z;

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

    console.log(`linearized cdf ${cdf}`);

    ps.push(cdf);
});

let indxs = [];
ps.forEach((p) => {
    let indx = math.round(n * p);
    indxs.push(indx);
    console.log(`rounded index ${indxs[0]}`);
});