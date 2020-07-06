import * as CryptoJS from 'crypto-js';
import * as ecdsa from 'elliptic';
import {existsSync, readFileSync, unlinkSync, writeFileSync} from "fs";

const fs = require('fs');
const _ = require('lodash');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const SHA256 = require("crypto-js/sha256");

class Transaction {
    constructor(fromPublicKey, toPublicKey, amount, timestamp, fromPort) {
        this.fromPublicKey = fromPublicKey;
        this.toPublicKey = toPublicKey;
        this.amount = amount;
        this.timestamp = timestamp;
        this.fromPort = fromPort;
        this.signature = this.getData();
    }
    
    getData(){
        return SHA256(this.fromPublicKey + this.toPublicKey + this.amount + this.fromPort).toString();
    }
}

class Block {
    constructor(index, timestamp, transactions, previousHash = '', difficulty) {
        this.index = index;
        this.timestamp = timestamp;
        this.transactions = transactions;
        this.previousHash = previousHash;
        this.difficulty = difficulty; //change this to determine computing power to mine and time it takes. 
        this.hash = this.calculateHash();
        this.nonce = 0;
    }

    calculateHash(){
        return SHA256(this.index + this.previousHash + this.nonce + this.timestamp + JSON.stringify(this.transactions)).toString();
    }

    mineBlock() {
        while(this.hash.substring(0, this.difficulty) !== Array(this.difficulty + 1).join("0")) { // loops until  '0 - difficulty' indexes of the hash starts with "0"
            this.nonce++; // Without this line itll be an endless loop since the hash of the data wont change, that why we add a nonce value (random number). There are probably better ways to randomize the nonce
            this.hash = this.calculateHash();
        }
        console.log('Block successfully mined: ' + this.hash );
    }
}

class Wallet {
/** 
 * @param {*} port URL on which you start the blockchain. 
 */
    constructor(port) {
        this.privateKey = this.generatePrivateKey();
        this.publicKey = this.getPublicKey();
        this.walletID = SHA256(this.port + this.publicKey + this.privateKey).toString();
        this.port = port;
    }

    generatePrivateKey() {
        let keyPair = ec.genKeyPair();
        let privateKey = keyPair.getPrivate();

        if(!fs.existsSync("privatekey")) {
            fs.writeFileSync("privatekey", privateKey.toString(16));
            console.log('New wallet with private key created!');
        }
        return fs.readFileSync("privatekey");
    }

    getPublicKey(){
        return ec.keyFromPrivate(this.privateKey, 'hex').getPublic().encode('hex').toString();
    }
    
    genTransaction() {
        let genTransaction = new Transaction("Coinbase", "0428cdf20edb2f707e9fc239eebb8e95d8086e3e3815233a39e2c30a6e1073045b6cfaa5bb2547f95db9d3379a75d16cfb194bcfc70b47402bb430377fe9a09604", 100000, Date.parse("2008-01-01"), null)
        return genTransaction;  
    }

    coinbaseTransactions(publicKey, amount, timestamp){
        let coinbaseTransaction = new Transaction("Coinbase", publicKey, amount, timestamp, null)
        return coinbaseTransaction;
    }

    sendTransaction(toPublicKey, amount, timestamp, fromPort) { //whenever you want to make a transaction use this method 
        let newTransaction = new Transaction(this.publicKey, toPublicKey, amount, timestamp, fromPort);
        return newTransaction;  
    }
 
    recieveTransaction(transaction) {
        let toPublicKey = transaction.toPublicKey;
        if (this.getPublicKey(this.privateKey) !== toPublicKey) {
            console.log("Trying to sign an input with private key that does not match the address that is referenced in the input transaction");
            return false
        }
        else {
            let key = ec.keyFromPrivate(this.privateKey,'hex');
            let data = transaction.signature;
            transaction.signature = this.toHexString(key.sign(data).toDER()); //DER encoded signature
            return transaction;
        }
    }

    toHexString(byteArray){
        return Array.from(byteArray, (byte) => {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2);
        }).join('');
    }
}

class Blockchain {
/** 
 * @param {*} genesisNode URL on which you start the blockchain.
 */
        constructor(genesisNode) {
            this.chain = []; //array of blocks
            this.pendingTransactions= []; //array of transactions not yet mined
            this.miningReward = 100; //way to circulate new coins in to the 'economy', can create a max limit and setup fee strucuture after max limit is reached. 
            this.nodes = [genesisNode];
            this.wallet = new Wallet(genesisNode);
            this.keyPortPair = {Key:this.wallet.publicKey, Port:genesisNode};
            this.addressBook = [this.keyPortPair];
            this.blockGenerationInterval= 10; // in seconds
            this.difficultyAdjustmentInterval= 4;// in blocks
        }
    // ------------------------------------------------------------------------------------------------ //
    // ----------------------------------Gossip Protocol Functions------------------------------------- //
    // ------------------------------------------------------------------------------------------------ //

    registerNode(ports, newPendingTransactions, newaddressBook) { //feeds new port numbers into node array and the port specific transactions are copied into the mem pool. 
        ports.map(node => {
            if (!this.nodes.includes(node)) {
                this.nodes.push(node);
            }
        })
        newPendingTransactions.map(transaction => {
            if (!this.pendingTransactions.includes(transaction)) {
                this.pendingTransactions.push(transaction)
            }
        })

        newaddressBook.map(address => {
            if (!this.addressBook.includes(address)) {
                this.addressBook.push(address)
            }
        })
    } 

    retrieveNodes() { //retrieves node array
        return this.nodes;
    }

    // ------------------------------------------------------------------------------------------------ //
    // --------------------------------------Create Functions------------------------------------------ //
    // ------------------------------------------------------------------------------------------------ //
    createGenesisBlock(){ //Creates and mines the genesis block, this is done every time a new Port is initiated. This means that when you initiate the blockchain "Satoshi" gets one million coins, and that is the total supply of coins in the system disregarding the newly minted coins. 
        let genTransaction = this.wallet.genTransaction(); 
        let genBlock = new Block(0, Date.parse("2008-01-01"), [genTransaction], "0", 1);
        console.log("\nGenesis Block Initiated...");
        genBlock.mineBlock();            
        return this.chain.push(genBlock);
        }

    sendTransaction(toPublicKey, amount, port) { //whenever you want to make a transaction use this method 
        let newTransaction = this.wallet.sendTransaction(toPublicKey, amount, this.getCurrentTimestamp(), port);
        if(newTransaction.amount > 0 && newTransaction.amount <= this.getBalanceOfAddress(this.wallet.publicKey)) {
        return newTransaction;
        }
        else {
            newTransaction = "Invalid Transaction";
            return newTransaction;
        }
    }

    recieveTransaction(transaction) {
        let verifiedTransaction = this.wallet.recieveTransaction(transaction);
        if(verifiedTransaction == false) {
            console.log("Public and Private Keys are not matching");
            return false;
        }
        else return verifiedTransaction;
    }
    
    pushTransactions(transaction) {
        this.pendingTransactions.push(transaction)
    }

    // ------------------------------------------------------------------------------------------------ //
    // ----------------------------------Mining Protocol Functions------------------------------------- //
    // ------------------------------------------------------------------------------------------------ //

    getDifficulty() { //gets difficulty and adjusts it based on latestBlock 
            let latestBlock = this.getLatestBlock();
            if (latestBlock.index % this.difficultyAdjustmentInterval === 0 && latestBlock.index !== 0) {
                return this.getAdjustedDifficulty(latestBlock);
            } 
            else return latestBlock.difficulty;
    };

    getAdjustedDifficulty(latestBlock) { //Adjusts difficulty based on seconds and number of block being mined. 
            let prevAdjustmentBlock= this.chain[this.chain.length - this.difficultyAdjustmentInterval];
            let timeExpected= this.blockGenerationInterval * this.difficultyAdjustmentInterval;
            let timeTaken= latestBlock.timestamp - prevAdjustmentBlock.timestamp;
            let newDifficulty;
            console.log("Time Taken: " + timeTaken + " = " + latestBlock.timestamp + " - " + prevAdjustmentBlock.timestamp);
            console.log("Time Expected: " + timeExpected + " = " + this.blockGenerationInterval + " * " + this.difficultyAdjustmentInterval);
            if (timeTaken < timeExpected/2) {
                newDifficulty = prevAdjustmentBlock.difficulty + 1;
                console.log("Difficulty increased to: " + newDifficulty + " | Previous difficulty: " + prevAdjustmentBlock.difficulty);
                return newDifficulty;
            } 
            else if (timeTaken > timeExpected * 2) {
                newDifficulty = prevAdjustmentBlock.difficulty - 1;
                console.log("Difficulty decreased to: " + newDifficulty + " Previous difficulty: " + prevAdjustmentBlock.difficulty);
                return newDifficulty;
            } 
            else return prevAdjustmentBlock.difficulty;
    };

    getAccumulatedDifficulty() { //Adds up ^2 of all difficulties for each block 
            let difficultyArray = [];
            let accumulativeDifficulty = 0;
            this.chain.map(block => {
                difficultyArray.push(block.difficulty);
            })
            difficultyArray.map(difficulty => {
                accumulativeDifficulty += Math.pow(2, difficulty); 
            })
            return accumulativeDifficulty
        }

    minePendingTransactions() { //mines pending transactions
            console.log('\nStarting the miner...');
            let previousBlock = this.getLatestBlock();
            let newIndex = previousBlock.index + 1;
            let newTimestamp = this.getCurrentTimestamp();
            let previousHash = previousBlock.hash;
            let difficulty = this.getDifficulty();
            let newBlock = new Block(newIndex, newTimestamp, this.pendingTransactions, previousHash, difficulty); //In reality the miner will need to choose which transactions he wants to mine, adding all pending transactions to a block may not be feasible due block size limitations etc...
            if(this.pendingTransactions.length >= 1) {
                if (this.isBlockValid(newBlock, previousBlock)) {
                newBlock.mineBlock(); 
                this.chain.push(newBlock); //now this mined block is added into the chain array
                }
                else return console.log("Invalid Block");
            }
            else return console.log("Not enough transactions to Mine.")
            if(this.chain.length>=1){
                this.isChainValid(this.chain);
                if(!this.isChainValid(this.chain)){
                    return console.log("There seems to be something wrong with this Blockchain");
                }
            }
        }

    updateBlockchain(publicKey, newChain) { //update blockchain if this chain is not the most difficult to compute across network 
            if(this.isChainValid(newChain)) {
            this.chain = newChain;
            this.pendingTransactions = [
                this.wallet.coinbaseTransactions(publicKey, this.miningReward, this.getCurrentTimestamp()) //once the pending transactions array is mined, it is reset with the first index in the array as the reward given to the miner. 
                ];
            }
            else return console.log("This new Blockchain is not valid!");
        }

    // ------------------------------------------------------------------------------------------------ //
    // ------------------------------------Validation Functions---------------------------------------- //
    // ------------------------------------------------------------------------------------------------ //
    isChainValid(chain){
        for(let i = 1; i < chain.length; i++){
            let currentBlock = chain[i];
            let previousBlock = chain[i-1];
            if (previousBlock.index + 1 !== currentBlock.index) {
                console.log('Invalid index');
                return false;
            }
            if(currentBlock.previousHash !== previousBlock.hash){ //The previous hash value stored within the current block is not the same as the previous blocks hash.
                return "This chain is not Valid. The previous hash value stored within the current block is not the same as the previous blocks hash.";
            }
        }
            return true;
        }

    isBlockValid(newBlock, previousBlock) {
        if (!this.isValidBlockStructure(newBlock)) {
            console.log('Invalid Structure');
            return false;
        }
        if(previousBlock.index !== 0) {
            if (previousBlock.index + 1 !== newBlock.index) {
                console.log('Invalid Index');
                return false;
            } 
            else if (previousBlock.hash !== newBlock.previousHash) {
                console.log('Invalid Previoushash');
                return false;
            } 
            else if (!this.isValidTimestamp(newBlock, previousBlock)) {
                console.log('Invalid Timestamp');
                return false;
            }
            else return true;
            }
        else return true;
        }

    isValidBlockStructure(block) {
        if(typeof block.index === 'number' && typeof block.hash === 'string' && typeof block.previousHash === 'string' && typeof block.timestamp === 'number' && typeof block.transactions === 'object'){
            return true
            }
        else return false
        }

    isValidTimestamp (newBlock, previousBlock){ 
        if(previousBlock.timestamp - 60 < newBlock.timestamp && newBlock.timestamp - 60 < this.getCurrentTimestamp()){
            return true
        }
        else return false
        }
    // ------------------------------------------------------------------------------------------------ //
    // --------------------------------------Helper Functions------------------------------------------ //
    // ------------------------------------------------------------------------------------------------ //
    getCurrentTimestamp() {
        let now = Math.floor(Date.now()/1000);
        return now;
        } 

    getLatestBlock(){
        return this.chain[this.chain.length - 1]; //gets the latest block by just indexing the length - 1 of the chain
        }


    getBalanceOfAddress(address) {
        let balance = 0;
        for(const blocks of this.chain) { //loops over all the blocks within this chain
            for(const trans of blocks.transactions) { //loops over all the transactions within this block
                if(trans.fromPublicKey == address) {
                    balance -= trans.amount; //subtract from balance if the address is in the fromAddress value
                }
                if(trans.toPublicKey == address) {
                    balance += trans.amount; //add from balance if the address is in the toAddress value
                }
            }
        }

        if(this.pendingTransactions.length >= 1) { // adding balance based on pending transactions should not be done since it is a major security flaw, however it is only placed for ease of testing.
            for (const pending of this.pendingTransactions) {
                if(pending.fromPublicKey === address) {
                    balance -= pending.amount; //subtract from balance if the address is in the fromAddress value
                }
                if(pending.toPublicKey === address) {
                    balance += pending.amount;
                }
            }
        } 
        console.log("\nBalance of " + address + " is " + balance);
        return balance;
    }
}

export {
    Blockchain, Block, Wallet, Transaction
}

