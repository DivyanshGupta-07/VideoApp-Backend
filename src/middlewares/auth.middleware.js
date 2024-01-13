import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import jwt from "jsonwebtoken";

export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    //grab the token from cookies or from header in case of mobile application
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized request");
    }

    //verify token
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    //extract _id from decodedToken and search in db
    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken"
    );

    if (!user) {
      throw new ApiError(401, "invalid access token");
    }

    //add a new feild in req ---> req.user
    req.user = user;

    //call next middleware or fn
    next();
  } catch (error) {
    throw new ApiError(401,error?.message || "invalid access token")
  }
});
