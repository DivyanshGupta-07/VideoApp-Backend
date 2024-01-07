import dotenv from "dotenv"
import mongoose from "mongoose";
import express from "express";
import connectDB from "./db/index.js";
dotenv.config()


connectDB();
// const app = express();











/*
( async () => {
    try {
        await mongoose.connect(`${process.env.MONGODB_URI}`)
        app.on("error", (error)=>{
            console.log("error",error)
            throw error;
        })
        app.listen(process.env.PORT, ()=>{
            console.log(`app is listening at port ${process.env.PORT}`);
        })
    } catch (error) {
        console.error("ERROR",error)
        throw error;
    }
})();
*/