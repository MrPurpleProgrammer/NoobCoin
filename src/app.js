import express from "express";
import bodyParser from "body-parser";
import rp from 'request-promise';
import cors from "./config/cors";
import { Blockchain, Block, Wallet, Transaction} from "./blockchain";

const ip = require('ip');
const port = process.env.PORT || 5000;
const ipAddress = ip.address().toString();
const blockchain = express();
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const SHA256 = require("crypto-js/sha256");
const address = String(ipAddress+":"+port);

/* ---------- */
/* Middelware */
/* ---------- */

blockchain.use(bodyParser.json());
blockchain.use(bodyParser.urlencoded({ extended: true }));
blockchain.use(cors);

/* ---------------- */
/* Global Variables */
/* ---------------- */

let Coin;

/* --------- */
/* Serve API */
/* --------- */

const instance = blockchain.listen(port, () => {
    Coin = new Blockchain(address);
    console.log(`Node listening on port ${address}!`);
    console.log("\nThis is your Public Key: " + Coin.wallet.publicKey);
    console.log("\nThis is your Private Key: " + Coin.wallet.privateKey);
    Coin.createGenesisBlock();
    propagateNodes("192.168.0.19:5000");
});

/* ----------------------------------------------------------------------------------- */    
/*                      Transaction Memory Pool (Rest API & Helper)                    */
/* ----------------------------------------------------------------------------------- */    

function recieveTransactions(transaction) {
    Coin.addressBook.map(keyPortPair => {
        if (transaction.toPublicKey == keyPortPair.Key) {
            let promise = rp.post({
                uri: `http://${keyPortPair.Port}/transactions/recieve`,
                body:{
                    "transaction": transaction
                },
                json: true
            })
            return console.log("Transaction was sent to: "+ keyPortPair.Port + ", " + keyPortPair.Key)
        }
    })
}

function propagateTransaction(transaction) {
    Coin.nodes.map(node => {
        let promise = rp.post({
            uri: `http://${node}/transactions/propagate`,
            body:{
                "transaction": transaction
            },
            json: true
        })
    })
}

/**
 * Add new transaction to blockchain.
 * @param {*} toAddress
 * @param {int} amount
 */
const transactions = (req, res) => {
    let fromPort = address;
    let transaction = Coin.sendTransaction(req.body.toAddress, req.body.amount, fromPort)
    if(typeof transaction !== 'string') {
        recieveTransactions(transaction);
        res.send("Transactions Sent");
    }
    else return res.send("Invalid Transaction");
}

const recieveTransaction = (req, res) => {
    let verifiedTransaction = Coin.recieveTransaction(req.body.transaction);
    if(verifiedTransaction !== false) {
        propagateTransaction(verifiedTransaction);
        console.log("Transaction Recieved");
        return res.send("Transaction Recieved");
    }
    else return res.send("Transaction could not be verified.");
}

const pushTransaction = (req, res) => {
    Coin.pushTransactions(req.body.transaction);
    res.send("Transaction Propagated");
}

/* ----------------------------------------------------------------------------------- */    
/*                        Gossip Protocol (Rest API & Helper)                          */
/* ----------------------------------------------------------------------------------- */    

async function propagateNodes(toPort) {
    if(!Coin.nodes.includes(toPort)) {
        let takePortPendingTransactionArray = rp.get({
        uri: `http://${toPort}/transactions`,
        json: true
        });
        let takeTransactions = await takePortPendingTransactionArray;

        let takeRegisteredNodes = rp.get({
        uri: `http://${toPort}/nodes`,
        json: true
        });
        let takeNodeArray = await takeRegisteredNodes;

        let takeDirEntry = rp.get({
            uri: `http://${toPort}/addressbook`,
            json: true
        });
        let takeDirectoryEntry = await takeDirEntry;
    
        Coin.nodes.map(fromNodes => {
            let addfromNodes = rp.post({
                uri: `http://${fromNodes}/nodes/add`,
                body: {
                    "nodeArray": takeNodeArray,
                    "transactionsArray": takeTransactions,
                    "bookEntry": takeDirectoryEntry
                },
                json: true
            });
        })
        
        takeNodeArray.map(toNodes => {
            let addtoNodes = rp.post({
                uri: `http://${toNodes}/nodes/add`,
                body: {
                    "nodeArray": Coin.nodes,
                    "transactionsArray": Coin.pendingTransactions,
                    "bookEntry": Coin.addressBook
                },
                json: true
            });
        })  
        console.log("Node Added")
    }
    else return console.log("Node already added.");   
}

/**
 * @param {*} port Port to start new blockchain node on.
 */
const registerNode = (req, res) => {
    propagateNodes(req.body.port);
    res.send("Nodes added and propagated");
}

const retrieveNodes = (req, res) => {
    res.json(Coin.retrieveNodes());
}

/**
 * @param {Object[]} nodeArray Port to start new blockchain node on.
 * @param {Object[]} transactionsArray
 * @param {Object[]} bookEntry
 */
const addNodes = (req, res) => {
    Coin.registerNode(req.body.nodeArray, req.body.transactionsArray, req.body.bookEntry);
    res.send("Nodes registered");
}

/* ----------------------------------------------------------------------------------- */    
/*                       Mining Protocol (Rest API & Helper)                           */
/* ----------------------------------------------------------------------------------- */    

async function findLongestBlockchain(minerAddress) {
    let promiseArray = [];
    let newChain = [];
    let thisPort = address;

    Coin.nodes.map(node => {
        // Get length of each blockchain in each node
        let promise = rp.get({
            uri: `http://${node}/blockchain/length`,
            json: true
        })
        promiseArray.push(promise);
    }) 

    let nodeLength = await Promise.all(promiseArray);

    let longestBlockchainNode = { chainLength: 0 };
    
    // Find node which holds longest chain
    nodeLength.map(node => {
        if (longestBlockchainNode.chainLength < node.chainLength) longestBlockchainNode = node;
    });

    let longestChain = await rp.get({
        uri: `http://${+longestBlockchainNode.port}/blockchain`,
        json: true
    });

    Coin.updateBlockchain(longestChain.chain, minerAddress, address);
}

async function findMostDifficultBlockchain(address) {
    let promiseArray = [];
    let newChain = [];
    let thisPort = address;

    Coin.nodes.map(node => {
        // Get length of each blockchain in each node
        let promise = rp.get({
            uri: `http://${node}/blockchain/difficulty`,
            json: true
        })
        promiseArray.push(promise);
    }) 

    let nodeAccumulatedDifficulty = await Promise.all(promiseArray);
    let mostDifficultBlockchainNode = {accumulatedDifficulty: 0};
    // Find node which holds longest chain
    nodeAccumulatedDifficulty.map(node => {
        if (mostDifficultBlockchainNode.accumulatedDifficulty < node.accumulatedDifficulty) mostDifficultBlockchainNode = node;
    });
    
    let mostDifficultChain = await rp.get({
        uri: `http://${mostDifficultBlockchainNode.port}/blockchain`,
        json: true
    });
    
    Coin.updateBlockchain(thisPort, mostDifficultChain);
}

const accumulatedDifficulty = (req, res) => {
    res.json({accumulatedDifficulty: Coin.getAccumulatedDifficulty(), address});
}

// If length of blockchain is larger as one -> it is a valid node
const lengthBlockchain = (req, res) => {
    res.json({chainLength: Coin.chain.length, address});
}

const updateBlockchain = (req, res) => {
    findMostDifficultBlockchain(req.body.minerAddress);
    res.send("Success!");
}

//Mine pending transactions and create new transaction for mining reward.
const mine = async (req, res) => {
    Coin.minePendingTransactions();
    let key = Coin.wallet.publicKey
    // Notify other blockchains a new block is added
    let promiseArray = [];

    Coin.nodes.map(node => {
        let promise = rp.get({
            uri: `http://${node}/blockchain/update`,
            body:{
                "minerAddress": key
            },
            json: true
        });

        promiseArray.push(promise);
    })
    await Promise.all(promiseArray);

    res.send("Mining Protocol run, check console to see status.");
}
   
/* ----------------------------------------------------------------------------------- */    
/*                                    REST API Routes                                  */
/* ----------------------------------------------------------------------------------- */    

/**
 * @param {int} port Port to start new blockchain node on.
 */
const printBlockchain = (req, res) => {
    const stringifiedChain = JSON.stringify(Coin.chain);
    res.send(stringifiedChain);
}

const retrieveBlockchain = (req, res) => {
    res.json(Coin.chain);
}

const getBalance = (req, res) => {
    let address = Coin.keyPortPair.Key;
    res.json({balance: Coin.getBalanceOfAddress(address)})
}

const pendingTransactions = (req, res) => {
    res.json(Coin.pendingTransactions)
}

const keyPortPair = (req, res) => {
    res.json(Coin.keyPortPair)
}

const addressBook = (req, res) => {
    res.json(Coin.addressBook)
}

//Blockchain:
blockchain.get("/blockchain", retrieveBlockchain);
blockchain.get("/blockchain/print", printBlockchain);
blockchain.get("/blockchain/length", lengthBlockchain);
blockchain.get("/blockchain/difficulty", accumulatedDifficulty);
blockchain.get("/blockchain/update", updateBlockchain);

//Balances:
blockchain.get("/balances/:address", getBalance);

//Transactions:
blockchain.route("/transactions")
    .post(transactions)
    .get(pendingTransactions);
blockchain.post("/transactions/recieve", recieveTransaction);
blockchain.post("/transactions/propagate", pushTransaction);

//Key:
blockchain.get("/address/add", keyPortPair);
blockchain.get("/addressbook", addressBook);
blockchain.post("/addressbook", )

//Mining:
blockchain.post("/mine", mine);

//Nodes:
blockchain.post("/nodes/add", addNodes);
blockchain.route("/nodes")
    .post(registerNode)
    .get(retrieveNodes);  
