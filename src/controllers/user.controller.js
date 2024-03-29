import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs, { appendFile } from "fs";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    //add refresh token into user db
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    //return access and refresh tokens
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "something went wrong while generating refresh and access tokens"
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  //get data from user
  const { fullName, userName, password, email } = req.body;

  //check for required feilds
  if (
    [fullName, email, userName, password].some((feild) => feild?.trim() === "")
  ) {
    throw new ApiError(400, "all feilds are required");
  }

  //user exists or not
  const existedUser = await User.findOne({
    $or: [{ userName }, { email }],
  });

  if (existedUser) {
    let avatarLocalPath = req.files?.avatar[0]?.path;
    let coverImageLocalPath;
    if (
      req.files &&
      Array.isArray(req.files.coverImage) &&
      req.files.coverImage.length > 0
    ) {
      coverImageLocalPath = req.files.coverImage[0].path;
      fs.unlinkSync(coverImageLocalPath);
    }
    if (avatarLocalPath) {
      fs.unlinkSync(avatarLocalPath);
    }
    throw new ApiError(409, "user with email or username already exists");
  }

  //check for images and avatar.........since we have addded a middleware {upload}, so multer provies us the access of "files" attribute just like express give us body,params etc
  const avatarLocalPath = req.files?.avatar[0]?.path;
  //const coverImageLocalPath = req.files?.coverImage[0]?.path

  let coverImageLocalPath;
  if (
    req.files &&
    Array.isArray(req.files.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required");
  }

  //upload on cloudinary
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar file is not uploaded !");
  }

  //create user object and entry in database
  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    userName: userName.toLowerCase(),
  });

  //check for sucessful user creation and remove unnecessary feilds from response like tokens etc
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "something went wrong while registering user");
  }

  //return final response
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered sucessfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  //get data from user
  const { email, userName, password } = req.body;

  if (!email && !userName) {
    throw new ApiError(400, "username or email is required");
  }

  //find user in db
  const user = await User.findOne({
    $or: [{ userName }, { email }],
  });

  if (!user) {
    throw new ApiError(404, "user does not exist");
  }

  //check password //here we use user insted of User bcs isPasswordCorrect is method of user not mongodb User
  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "password incorrect");
  }

  //generate access and refresh token by calling methods
  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  //this is an optional step
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  //set some options so that no one can modify cookies from frontend
  const options = {
    httpOnly: true,
    secure: true,
  };

  //send {access,refresh tokens in cookies} and response
  res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "user logged in sucessfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  //find user and set its refresh token to undefined
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $unset: {
        refreshToken: 1, //this will unset the given feild
      },
    },
    {
      new: true,
    }
  );

  //clear cookies and return response
  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "user logged out"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  //grab the refresh token
  const incommingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!incommingRefreshToken) {
    throw new ApiError(401, "unauthorized request on refreshing tokens");
  }

  try {
    //verify the token
    const decodedToken = jwt.verify(
      incommingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    //find data using decoded token
    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, "invalid refresh token");
    }

    if (incommingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "refresh token is expired or used");
    }

    //if every thing till right , generate new token and update
    const options = {
      httpOnly: true,
      secure: true,
    };

    const { accessToken, newRefreshToken } =
      await generateAccessAndRefreshTokens(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          {
            accessToken,
            refreshToken: newRefreshToken,
          },
          "Access Token Refreshed"
        )
      );
  } catch (error) {
    throw new ApiError(401,error?.message || "invalid refresh token")
  }
});

const changeCurrentPassword = asyncHandler(async (req,res) =>{
  //get data from user
  const {oldPassword, newPassword} = req.body;

  const user = await User.findById(req.user?._id)

  //validate password
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)
  if(!isPasswordCorrect){
    throw new ApiError(400,"invalid password")
  }

  //set new password
  user.password = newPassword

  await user.save({validateBeforeSave:false})

  return res
  .status(200)
  .json(new ApiResponse(200,{},"password change sucessfully"))
})

const getCurrentUser = asyncHandler( async(req,res) => {
  return res
  .status(200)
  .json(new ApiResponse(200,req.user,"current user fetched sucessfully"))
})

const updateAccountDetails = asyncHandler(async(req,res) =>{
  //get data from user
  const {email,fullName} = req.body

  if(!fullName || !email){
    throw new ApiError(400,"all feilds are required")
  }

  //find and update
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullName,
        email:email
      }
    },
    {
      new: true
    }
  ).select("-password")

  //return
  return res
  .status(200)
  .json(new ApiResponse(200,user,"Account details sucessfully updated"))
})

const updateUserAvatar = asyncHandler( async(req,res) => {
  //get local file path 
  const avatarLocalPath = req.file?.path

  if(!avatarLocalPath){
    throw new ApiError(400,"Avatar file is missing")
  }

  //upload on cloudinary
  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if(!avatar.url){
    throw new ApiError(400,"error while uploading on avatar")
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set:{
        avatar: avatar.url
      }
    },
    {
      new:true
    }
  ).select("-password")

  return res
  .status(200)
  .json(new ApiResponse(200,user,"avatar updated sucessfully"))
})

const updateUserCoverImage = asyncHandler(async(req,res) => {
  const coverImageLocalPath = req.file?.path

  if(!coverImageLocalPath){
    return new ApiError(400,"Cover image file is missing")
  }

  const coverImage = await uploadOnCloudinary(coverImageLocalPath)

  if(!coverImage.url){
    return new ApiError(400,"error while uploading cover image")
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set:{
        coverImage: coverImage.url
      }
    },
    {
      new: true
    }
  ).select("-password")

  return res
  .status(200)
  .json(200,user,"cover image updated sucessfully")
})

const getUserChannelProfile = asyncHandler(async(req,res) => {
  //get username from params of url
  const {userName} = req.params
  if(!userName){
    throw new ApiError(400,"username is missing while finding channel profile")
  }

  //apply aggregate pipelines
  const channel = await User.aggregate([
    {
      $match : {
        userName : userName?.toLowerCase()
      }
    },
    {
      $lookup:{
        from: "subscriptions",
        localField: "_id",
        foreignField:"channel",
        as: "subscribers"
      }
    },
    {
      $lookup:{
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo"
      }
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers"
        },
        channelsSubscribedToCount:{
          $size:"$subscribedTo"
        },
        isSubscribed:{
          $cond:{
            if: {$in: [req.user?._id, "$subscribers.subscriber"]},
            then: true,
            else: false
          }
        }
      }
    },
    {
      $project:{
        fullName:1,
        userName:1,
        subscribersCount:1,
        channelsSubscribedToCount:1,
        isSubscribed:1,
        avatar:1,
        coverImage:1,
        email:1
      }
    }
  ])

  if(!channel?.length){
    throw new ApiError(404,"channel dosent exist")
  }

  return res
  .status(200)
  .json(new ApiResponse(200,channel[0],"user channel fetched sucessfully"))
})

const getWatchHistory = asyncHandler(async(req,res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user?._id)   //gyan ki baat "_id dosent return the real id of document, it actually returns a string . to convert this string in real id ->  new mongoose.Types.ObjectId(req.user._id)"
      }
    },
    {
      $lookup: {
        from : "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipeline: [
          {
            $lookup:{
              from: "users",
              localField:"owner",
              foreignField:"_id",
              as: "owner",
              pipeline: [
                {
                  $project:{
                    fullName:1,
                    userName:1,
                    avatar:1
                  }
                }
              ]
            }
          },
          {
            $addFields:{
              owner:{
                $first:"$owner"
              }
            }
          }
        ]
      }
    }
  ])
  
  return res
  .status(200)
  .json(new ApiResponse(200,user[0].watchHistory,"watch history featched sucessfully"))
})

export { 
  registerUser,
   loginUser, 
   logoutUser,
   refreshAccessToken,
   getCurrentUser,
   changeCurrentPassword,
   updateAccountDetails ,
   updateUserAvatar,
   updateUserCoverImage,
   getUserChannelProfile,
   getWatchHistory
  };
