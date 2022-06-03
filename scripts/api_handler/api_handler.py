import boto3
import json
import os
import decimal

SFN_ARN = os.environ.get('SFN_ARN') # Env variable passed by CDK

sfn = boto3.client('stepfunctions')

def lambda_handler(event, context):
    print('EVENT:')
    print(event)
    event['waitSeconds'] = int(event['waitSeconds'])
    
    # Validation Checks
    checks = []
    checks.append('waitSeconds' in event)
    checks.append(type(event['waitSeconds']) == int)
    checks.append('preference' in event)
    checks.append('message' in event)
    if event.get('preference') == 'sms':
        checks.append('phone' in event)
    if event.get('preference') == 'email':
        checks.append('email' in event)

    # Check for any errors in validation checks
    if False in checks:
        response = {
            "statusCode": 400,
            "headers": {"Access-Control-Allow-Origin":"*"},
            "body": json.dumps(
                {
                    "Status": "Success", 
                    "Reason": "Input failed validation"
                },
                cls=DecimalEncoder
            )
        }
    # If none, run the state machine and return a 200 code saying this is fine :)
    else: 
        sfn.start_execution(
            stateMachineArn=SFN_ARN,
            input=json.dumps(event, cls=DecimalEncoder)
        )
        response = {
            "statusCode": 200,
            "headers": {"Access-Control-Allow-Origin":"*"},
            "body": json.dumps(
                {"Status": "Success"},
                cls=DecimalEncoder
            )
        }
    return response

# This is a workaround for: http://bugs.python.org/issue16535
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return int(obj)
        return super(DecimalEncoder, self).default(obj)

