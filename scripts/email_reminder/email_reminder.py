import boto3
import os

EMAIL = os.environ.get('EMAIL') # Env variable passed by CDK

ses = boto3.client('ses')

def lambda_handler(event, context):
    ses.send_email(
        Source=EMAIL,
        Destination={
            'ToAddresses': [event['email']]  # Also a verified email
        },
        Message={
            'Subject': {'Data': 'A reminder from your reminder service!'},
            'Body': {'Text': {'Data': event['message']}}
        }
    )
    return 'Success!'