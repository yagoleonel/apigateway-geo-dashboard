import { CloudWatchLogsEvent } from 'aws-lambda';
import { unzipSync } from 'zlib';
import * as apigtw from 'aws-cdk-lib/aws-apigateway'
import axios from 'axios'

export const handler = async (event: CloudWatchLogsEvent): Promise<void> => {
    const decodedEvent = Buffer.from(event.awslogs.data, 'base64');
    const logEvents = JSON.parse(unzipSync(decodedEvent).toString()).logEvents;

    for (const logEvent of logEvents) {
        const message = JSON.parse(logEvent.message) as apigtw.JsonWithStandardFieldProps;
        const {
            ip,
            status,
            resourcePath: path,
            httpMethod: method
        } = message;
        
        const publicApiResponse = await axios.get(`${process.env.OPEN_GEOLOCATION_API_URL}/json/${ip}`, {
            timeout: 3000,
        })
    
        if (publicApiResponse.status === 200) {
            const {
                country,
                city,
            } = publicApiResponse.data;

            console.log(JSON.stringify({
                geo_api_data: {
                    country,
                    city,
                    timestamp: new Date().toISOString(),
                    ip,
                    path,
                    method,
                    status
                }
            }))
        }
    }
}