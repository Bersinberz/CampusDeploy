import { Schema, model } from 'mongoose'

const deploymentSchema = new Schema(
  {
    name:          { type: String, required: true, trim: true },
    email:         { type: String, required: true, trim: true, lowercase: true },
    repoUrl:       { type: String, required: true, trim: true },
    status:        { type: String, enum: ['queued', 'building', 'live', 'failed'], default: 'queued' },
    projectFolder: { type: String, trim: true },
    serverIp:      { type: String, trim: true },
    deployUrl:     { type: String, trim: true },
    deployLogs:    { type: String },
    retryCount:    { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const Deployment = model('Deployment', deploymentSchema)
