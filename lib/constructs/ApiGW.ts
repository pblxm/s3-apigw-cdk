import { CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib";
import { CfnDeployment, CfnMethod, CfnModel, CfnResource, CfnRestApi, CfnStage } from "aws-cdk-lib/aws-apigateway";
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

const region = 'us-east-1'

export class APIGW extends Construct {
    public readonly apiEndpoint: string
    constructor(scope: Construct, id: string){
        super(scope, id)

        // S3 BUCKET
        
        const bucket = new Bucket(this, 'static-web', {
            bucketName: 'pmonllor-web-test',
            publicReadAccess: true,
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'error.html',
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY
        })

        const bucketDeployment = new BucketDeployment(this, 'deployment',{
            destinationBucket: bucket,
            sources: [Source.asset('./scripts/static_website')],
        })

        new CfnOutput(this, 'bucket-url',{
            value: bucket.bucketWebsiteUrl
        })


        // SNS

        const textRole = new Role(this, 'text-role', {
            roleName: 'textRole',
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        })

        textRole.addToPolicy(new PolicyStatement({
            actions: ['sns:Publish'],
            resources: [`*`]
        }))

        const smsReminder = new Function(this, 'sms-reminder', {
            functionName: 'smsReminder',
            code: Code.fromAsset('./scripts/sms_reminder'),
            runtime: Runtime.PYTHON_3_9,
            handler: 'sms_reminder.lambda_handler',
            role: textRole
        })

        
        // SES

        const emailRole = new Role (this, 'email-role', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com')
        })

        // You need to create a verified email in the AWS Console in order to send emails
        const email = '' 

        emailRole.addToPolicy(new PolicyStatement({
                actions: [
                    'ses:SendEmail',
                    'ses:SendRawEmail',
                    'ses:SendTemplatedEmail',
                ],
                resources: [`arn:aws:ses:${region}:${Stack.of(this).account}:identity/${email}`]
        }))

        emailRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'))

        const emailReminder = new Function(this, 'email-reminder', {
            functionName: 'emailReminder',
            code: Code.fromAsset('./scripts/email_reminder'),
            runtime: Runtime.PYTHON_3_9,
            handler: 'email_reminder.lambda_handler',
            environment: { 'EMAIL': email },
            role: emailRole
        })


        // STEP FUNCTIONS 
        
        const stateRole = new Role(this, 'state-role', {
            roleName: 'stateRole',
            assumedBy: new ServicePrincipal('states.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        })

        stateRole.addToPolicy(new PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [emailReminder.functionArn, smsReminder.functionArn]
        }))

        // Import Step Function template
        const template = require('../../scripts/step-function-template.json');

        // Modify template with lambda functions ARNs
        template.States.TextReminder.Resource = smsReminder.functionArn
        template.States.EmailReminder.Resource = emailReminder.functionArn
        template.States.BothReminders.Branches[0].States.EmailReminderPar.Resource = smsReminder.functionArn
        template.States.BothReminders.Branches[1].States.TextReminderPar.Resource = emailReminder.functionArn 

        const stateMachine = new CfnStateMachine(this, 'state-machine', {
            roleArn: stateRole.roleArn,
            definition: template,
            stateMachineName: 'state-machine-234523252',
            stateMachineType: 'STANDARD',
        })


        // API HANDLER

        const apiHandlerRole = new Role(this, 'api-handler-role', {
            roleName: 'apiHandlerRole',
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        })

        apiHandlerRole.addToPolicy(new PolicyStatement({
            actions: ['states:Start*', 'states:StopExecution'],
            resources: [stateMachine.attrArn]
        }))
        
        const apiHandler = new Function(this, 'api-handler', {
            functionName: 'apiHandler',
            code: Code.fromAsset('./scripts/api_handler'),
            runtime: Runtime.PYTHON_3_9,
            handler: 'api_handler.lambda_handler',
            environment: { 'SFN_ARN': stateMachine.attrArn },
            role: apiHandlerRole
        })


        // API GATEWAY

        // Role to allow API Gateway to invoke API Handler function
        const apiRole = new Role(scope, 'apiRole', {
            roleName: 'apiRole',
            assumedBy: new ServicePrincipal('apigateway.amazonaws.com')
        });
          
        apiRole.addToPolicy(new PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [apiHandler.functionArn] 
        }))
        
        const api = new CfnRestApi(this, 'api-gateway', {
            name: 'ej-api-gateway',
            endpointConfiguration: {
                types: ['REGIONAL'],
            },
        }) 
        
        const resource = new CfnResource(this, 'resource', {
            restApiId: api.ref,
            pathPart: 'reminders',
            parentId: api.attrRootResourceId
        })
        
        const postMethod = new CfnMethod(this, 'postMethod', {
            restApiId: api.ref,
            httpMethod: 'POST',
            resourceId: resource.ref,
            authorizationType: 'NONE',
            apiKeyRequired: false,
            integration: {
                integrationHttpMethod: 'POST',
                type: 'AWS',
                uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${apiHandler.functionArn}/invocations`,
                integrationResponses: [
                    {
                        statusCode: "200",
                        responseParameters: {
                            "method.response.header.Access-Control-Allow-Origin":
                                "'*'"
                        },
                        responseTemplates: { 
                            "application/json": ""
                        },
                    }
                ],
                requestTemplates: {
                    "application/json": ""
                }
            },
            methodResponses: [
                {
                    statusCode: "200",
                    responseModels: { 
                        'application/json': 'Empty'
                    },
                    responseParameters: {
                        "method.response.header.Access-Control-Allow-Origin": true,
                    },
                }
            ],         
        })

        const optionsMethod = new CfnMethod(this, 'options-method', {
            restApiId: api.ref,
            httpMethod: 'OPTIONS',
            resourceId: resource.ref,
            authorizationType: 'NONE',
            apiKeyRequired: false,
            integration: {
                integrationHttpMethod: 'OPTIONS',
                type: 'MOCK',
                integrationResponses: [
                    {
                        statusCode: "200",
                        responseParameters: {
                            "method.response.header.Access-Control-Allow-Headers":
                                "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                            "method.response.header.Access-Control-Allow-Methods":
                                "'OPTIONS,POST'",
                            'method.response.header.Access-Control-Allow-Origin':
                                `'${bucket.bucketWebsiteUrl}'`
                        },
                        responseTemplates: {
                            "application/json": ""
                        },
                    }
                ],
                requestTemplates: {
                    "application/json": "{\"statusCode\": 200}"
                }
            },
            requestModels: {
                'application/json': 'Empty',
            },
            methodResponses: [
                {
                    statusCode: "200",
                    responseModels: {
                        'application/json': 'Empty'
                    },
                    responseParameters: {
                        "method.response.header.Access-Control-Allow-Headers": true,
                        "method.response.header.Access-Control-Allow-Methods": true,
                        "method.response.header.Access-Control-Allow-Origin": true,
                    }
                }
            ],

        })

        const apideploy = new CfnDeployment(this, 'api-deploy', {
            restApiId: api.ref
       })

       apideploy.addDependsOn(postMethod)

       const prodstage = new CfnStage(this, 'prod-stage', {
        restApiId: api.ref,
        stageName: 'prod',
        deploymentId: apideploy.ref
       })

       apiHandler.addPermission('apigw-invoke', {
        principal: new ServicePrincipal('apigateway.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: `arn:aws:execute-api:${region}:${Stack.of(this).account}:${api.ref}/*/POST/reminders`
       })

        // LAMBDA FUNCTION TO ADD API GATEWAY ENDPOINT TO A NEW JSON FILE IN THE BUCKET

        const writeRole = new Role(this, 'write-role', {
            roleName: 'writeS3Role',
            assumedBy: new ServicePrincipal('lambda.amazonaws.com')
        })

        writeRole.addToPolicy(new PolicyStatement({
            actions: ['s3:PutObject'],
            resources: [`${bucket.bucketArn}/*`]
        }))

        const writeS3 = new Function(this, 'write-s3', {
            functionName: 'write-to-s3',
            code: Code.fromAsset('./scripts/write_file'),
            runtime: Runtime.NODEJS_14_X,
            handler: 'index.handler',
            environment: { 
                'API_ENDPOINT': `https://${api.ref}.execute-api.${region}.amazonaws.com/prod/reminders`, 
                'BUCKET_NAME': bucket.bucketName 
            },
            role: writeRole,
        })

        // CUSTOM RESOURCE TO INVOKE LAMBDA AFTER DEPLOYMENT 
        const writeFile = new AwsCustomResource(this, 'invoke-s3', {
            policy: AwsCustomResourcePolicy.fromStatements([new PolicyStatement({
                actions: ['lambda:InvokeFunction'],
                resources: [writeS3.functionArn] 
            })]),
            onCreate: {
                service: 'Lambda',
                action: 'invoke',
                parameters: {
                  FunctionName: writeS3.functionName,
                  InvocationType: 'Event'
                },
                physicalResourceId: PhysicalResourceId.of('writeFileInvoker')
            },
            onUpdate: {
                service: 'Lambda',
                action: 'invoke',
                parameters: {
                  FunctionName: writeS3.functionName,
                  InvocationType: 'Event'
                },
                physicalResourceId: PhysicalResourceId.of('writeFileInvokerUpdate')
            }
       })

       bucketDeployment.node.addDependency(api)
       writeFile.node.addDependency(bucketDeployment)
       writeS3.node.addDependency(bucketDeployment)

    }
}
