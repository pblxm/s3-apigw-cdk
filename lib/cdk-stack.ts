import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { APIGW } from './constructs/apigw';

export class MyStack extends Stack {
  public readonly apiEndpoint: string
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const api = new APIGW(this, 'test')
    
  }
}