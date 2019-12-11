const redis = require("redis");
const redisClient = redis.createClient();
const db = require("./db");

const intId = setInterval(() => {
  // if anything in queue, process it using BLPOP - blocking list left pop
  redisClient.blpop("webhookqueue", 0, (err, msg) => {
    if (!msg) {
      clearInterval(intId);
      redisClient.quit();
    }
    let data = JSON.parse(msg[1]);
    let notebookId = Object.keys(data)[0];
    let webhookData = data[notebookId];

    console.log("webhookqueue msg : ", msg);

    db("WEBHOOK", null, notebookId, webhookData);
  });
}, 100);
