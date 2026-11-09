## Common Services Workflow Plugin usage

### Configure CSTAR

You need to enable Workflow in CSTAR in order to assign users to the workflow appliaction to be able to access it

### Configure Workflow

1. Log in to workflow, and navigate to N8n
2. Create an api Key (Settings -> n8n Api, create)
3. Add a credential of type Header Auth
4. This header should get the header 'X-N8N-API-KEY' and the value of the api key from step 2
5. in the backend set up your env to point to the connected service workflow url, update the set the api key and switch from noop workflow

### Configuring workflows

When you create a workflow it MUST be initiated by a webhook
The webhook MUST be on POST
The webhook MUST use header authentication and the header credential from configuring workflow
The webhook MUST have a unique name.

### Using Workflows in the backend code

When kicking off the workflow, the backend should utilize the name to fetch the workflow and then be able to kick it off using the id. We could skip a step and use the ID but that won't be portable to dev/test/prod and is also less human readable.
