import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import {User} from "../models/user.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js";
import fs from 'fs'


const registerUser = asyncHandler( async (req,res) => {

    //get data from user
    const {fullName,userName,password,email} = req.body
    
    //check for required feilds
    if(
        [fullName,email,userName,password].some((feild)=> feild?.trim() === "")
    ){
        throw new ApiError(400,"all feilds are required")
    }

    //user exists or not
    const existedUser = await User.findOne({
        $or:[{userName},{email}]
    })

    if(existedUser){
        let avatarLocalPath = req.files?.avatar[0]?.path
        let coverImageLocalPath;
        if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
            coverImageLocalPath =  req.files.coverImage[0].path;
            fs.unlinkSync(coverImageLocalPath)
        }
        if(avatarLocalPath){
            fs.unlinkSync(avatarLocalPath)
        }
        throw new ApiError(409,"user with email or username already exists");
    };

    //check for images and avatar.........since we have addded a middleware {upload}, so multer provies us the access of "files" attribute just like express give us body,params etc
    const avatarLocalPath = req.files?.avatar[0]?.path
    //const coverImageLocalPath = req.files?.coverImage[0]?.path

    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath =  req.files.coverImage[0].path;
    }

    if(!avatarLocalPath){
        throw new ApiError(400,"Avatar file is required")
    }

    //upload on cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    
    if(!avatar){
        throw new ApiError(400,"Avatar file is not uploaded !")
    }

    //create user object and entry in database
    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        userName: userName.toLowerCase()
    })

    //check for sucessful user creation and remove unnecessary feilds from response like tokens etc
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500,"something went wrong while registering user")
    }

    //return final response
    return res.status(201).json(
        new ApiResponse(200,createdUser,"User registered sucessfully")
    )
})

// const loginUser = asyncHandler( async (req,res) => {

// })

export {registerUser}