import mongoose from 'mongoose'

const connectDB = async () => {
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/campusDeploy-db'
  await mongoose.connect(uri)
  console.log('MongoDB connected')
}

export default connectDB
