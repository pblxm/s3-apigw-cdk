const { S3 } = require("@aws-sdk/client-s3");

const client = new S3({ region: "us-east-1" });

const api = process.env.API_ENDPOINT
const Bucket = process.env.BUCKET_NAME

const data = {
    API_ENDPOINT: api
}

const params = {
    Bucket,
    Key: 'data.json',
    Body: JSON.stringify(data, null, 2),
};

exports.handler = async () => {
    try {
        const response = await client.putObject(params);
        console.log('Response: ', response);
        return response;

    } catch (err) {
        console.log(err);
    }
};
