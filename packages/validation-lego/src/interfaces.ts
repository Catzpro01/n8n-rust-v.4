/**
 * Type-only surface consumed by the Validation LEGO.
 *
 * Re-declared structurally from `reference/n8n/packages/workflow/src/interfaces.ts`
 * (read-only, hash-pinned). This keeps the Validation LEGO self-contained and free of
 * circular cross-package dependencies while ensuring exact structural compatibility.
 */

export const NodeConnectionTypes = {
	AiAgent: 'ai_agent',
	AiChain: 'ai_chain',
	AiDocument: 'ai_document',
	AiEmbedding: 'ai_embedding',
	AiLanguageModel: 'ai_languageModel',
	AiMemory: 'ai_memory',
	AiOutputParser: 'ai_outputParser',
	AiRetriever: 'ai_retriever',
	AiReranker: 'ai_reranker',
	AiTextSplitter: 'ai_textSplitter',
	AiTool: 'ai_tool',
	AiVectorStore: 'ai_vectorStore',
	Main: 'main',
} as const;

export type NodeConnectionType = (typeof NodeConnectionTypes)[keyof typeof NodeConnectionTypes];

export const nodeConnectionTypes: NodeConnectionType[] = Object.values(NodeConnectionTypes);

export interface IConnection {
	node: string;
	type: NodeConnectionType;
	index: number;
}

export type NodeInputConnections = Array<IConnection[] | null>;

export interface INodeConnections {
	[key: string]: NodeInputConnections;
}

export interface IConnections {
	[key: string]: INodeConnections;
}

export interface IBinaryData {
	data?: string;
	mimeType: string;
	fileName?: string;
	directory?: string;
	fileExtension?: string;
	fileSize?: string;
	id?: string;
	[key: string]: unknown;
}

export type FormFieldsParameter = Array<{
	fieldLabel?: string;
	fieldType?: string;
	placeholder?: string;
	defaultValue?: string | number | boolean;
	fieldOptions?: { values: Array<{ option: string }> } | unknown;
	multiselect?: boolean;
	multipleFiles?: boolean;
	acceptFileTypes?: string;
	formatDate?: string;
	requiredField?: boolean;
	fieldValue?: string;
	elementName?: string;
	html?: string;
	fieldName?: string;
	limitSelection?: boolean;
	numberOfSelections?: number;
	minSelections?: number;
	maxSelections?: number;
	[key: string]: unknown;
}>;

export type FieldTypeMap = {
	boolean: boolean;
	number: number;
	string: string;
	'string-alphanumeric': string;
	dateTime: string;
	time: string;
	array: unknown[];
	object: object;
	options: any;
	url: string;
	jwt: string;
	'form-fields': FormFieldsParameter;
	binary: string;
};

export type FieldType = keyof FieldTypeMap;

export type ValidationResult<T extends FieldType = FieldType> =
	| { valid: false; errorMessage: string }
	| {
			valid: true;
			newValue?: FieldTypeMap[T];
	  };

export interface INodePropertyOptions {
	name: string;
	value: string | number | boolean;
	action?: string;
	description?: string;
	routing?: INodePropertyRouting;
	outputConnectionType?: NodeConnectionType;
	inputSchema?: any;
	displayOptions?: IDisplayOptions;
	disabledOptions?: undefined;
}

export interface INodeProperties {
	displayName?: string;
	name: string;
	type: string;
	options?: INodePropertyOptions[] | INodeProperties[] | INodePropertyCollection[];
	[key: string]: unknown;
}

export interface INodePropertyCollection {
	name: string;
	displayName: string;
	values: INodeProperties[];
	[key: string]: unknown;
}

export type ResourceLocatorModes = 'id' | 'name' | 'url' | 'list';

export interface INodeParameterResourceLocator {
	__rl: true;
	mode: ResourceLocatorModes | string;
	value: string | number | null;
	cachedResultName?: string;
	cachedResultUrl?: string;
	__regex?: string;
}

export type NodeParameterValue = string | number | boolean | undefined | null;

export type GenericValue = string | object | number | boolean | undefined | null;

export interface IDataObject {
	[key: string]: GenericValue | IDataObject | GenericValue[] | IDataObject[];
}

export type DisplayCondition =
	| { _cnd: { eq: NodeParameterValue } }
	| { _cnd: { not: NodeParameterValue } }
	| { _cnd: { gte: number | string } }
	| { _cnd: { lte: number | string } }
	| { _cnd: { gt: number | string } }
	| { _cnd: { lt: number | string } }
	| { _cnd: { between: { from: number | string; to: number | string } } }
	| { _cnd: { startsWith: string } }
	| { _cnd: { endsWith: string } }
	| { _cnd: { includes: string } }
	| { _cnd: { regex: string } }
	| { _cnd: { exists: true } };

export interface IDisplayOptions {
	hide?: {
		[key: string]: Array<NodeParameterValue | DisplayCondition> | undefined;
	};
	show?: {
		'@version'?: Array<number | DisplayCondition>;
		'@feature'?: Array<string | DisplayCondition>;
		'@tool'?: boolean[];
		[key: string]: Array<NodeParameterValue | DisplayCondition> | undefined;
	};
	hideOnCloud?: boolean;
}

export interface ResourceMapperField {
	id: string;
	displayName: string;
	defaultMatch: boolean;
	canBeUsedToMatch?: boolean;
	required: boolean;
	display: boolean;
	type?: FieldType;
	removed?: boolean;
	options: INodePropertyOptions[];
	readOnly?: boolean;
}

export interface ResourceMapperFields {
	fields: ResourceMapperField[];
	emptyFieldsNotice?: string;
}

export type ResourceMapperValue = {
	mappingMode: string;
	value: { [key: string]: string | number | boolean | null } | null;
	matchingColumns: string[];
	schema: ResourceMapperField[];
	attemptToConvertTypes: boolean;
	convertFieldsToString: boolean;
};

export type FilterOptionsValue = {
	caseSensitive: boolean;
	leftValue: string;
	typeValidation: 'strict' | 'loose';
	version: 1 | 2 | 3;
};

export type FilterOperatorType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'array'
	| 'object'
	| 'dateTime'
	| 'any';

export interface FilterOperatorValue {
	type: FilterOperatorType;
	operation: string;
	rightType?: FilterOperatorType;
	singleValue?: boolean;
}

export type FilterConditionValue = {
	id: string;
	leftValue: NodeParameterValue | NodeParameterValue[];
	operator: FilterOperatorValue;
	rightValue: NodeParameterValue | NodeParameterValue[];
};

export type FilterTypeCombinator = 'and' | 'or';

export type FilterValue = {
	options: FilterOptionsValue;
	conditions: FilterConditionValue[];
	combinator: FilterTypeCombinator;
};

export type AssignmentValue = {
	id: string;
	name: string;
	value: string | number | boolean | null;
	type?: string;
};

export type AssignmentCollectionValue = {
	assignments: AssignmentValue[];
};

export type IconOrEmoji = { type: 'icon'; value: string } | { type: 'emoji'; value: string };

export type NodeParameterValueType =
	| NodeParameterValue
	| INodeParameters
	| INodeParameterResourceLocator
	| ResourceMapperValue
	| FilterValue
	| AssignmentCollectionValue
	| IconOrEmoji
	| NodeParameterValue[]
	| INodeParameters[]
	| INodeParameterResourceLocator[]
	| ResourceMapperValue[];

export interface INodeParameters {
	[key: string]: NodeParameterValueType;
}

export type OnError = 'continueErrorOutput' | 'continueRegularOutput' | 'stopWorkflow';

export interface INodeCredentialsDetails {
	id: string | null;
	name: string;
}

export interface INodeCredentials {
	[key: string]: INodeCredentialsDetails;
}

export interface INode {
	id: string;
	name: string;
	typeVersion: number;
	type: string;
	position: [number, number];
	disabled?: boolean;
	notes?: string;
	notesInFlow?: boolean;
	retryOnFail?: boolean;
	maxTries?: number;
	waitBetweenTries?: number;
	alwaysOutputData?: boolean;
	executeOnce?: boolean;
	onError?: OnError;
	continueOnFail?: boolean;
	webhookId?: string;
	extendsCredential?: string;
	rewireOutputLogTo?: NodeConnectionType;
	parameters: INodeParameters;
	credentials?: INodeCredentials;
	forceCustomOperation?: {
		resource: string;
		operation: string;
	};
	[key: string]: unknown;
}

export interface INodes {
	[key: string]: INode;
}

export interface IHttpRequestOptions {
	url: string;
	baseURL?: string;
	headers?: IDataObject;
	method?: string;
	body?: any;
	qs?: IDataObject;
	arrayFormat?: 'indices' | 'brackets' | 'repeat' | 'comma';
	auth?: {
		username: string;
		password: string;
		sendImmediately?: boolean;
	};
	json?: boolean;
	encoding?: any;
	gzip?: boolean;
	rejectUnauthorized?: boolean;
	followRedirect?: boolean;
	followAllRedirects?: boolean;
	maxRedirects?: number;
	timeout?: number;
	proxy?: any;
	returnFullResponse?: boolean;
	skipSslCertificateValidation?: boolean | string;
	[key: string]: any;
}

export interface IExecuteSingleFunctions {
	[key: string]: any;
}

export interface IExecutePaginationFunctions extends IExecuteSingleFunctions {
	[key: string]: any;
}

export type PreSendAction = (
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
) => Promise<IHttpRequestOptions>;

export interface INodeExecutionData {
	json: IDataObject;
	binary?: Record<string, IBinaryData>;
	[key: string]: unknown;
}

export interface IN8nHttpFullResponse {
	body: any;
	headers: IDataObject;
	statusCode: number;
	statusMessage?: string;
}

export interface IPostReceiveBinaryData {
	type: 'binaryData';
	enabled?: boolean | string;
	properties: {
		destinationProperty: string;
		[key: string]: unknown;
	};
	errorMessage?: string;
}

export interface IPostReceiveFilter {
	type: 'filter';
	enabled?: boolean | string;
	properties: {
		pass: boolean | string;
		[key: string]: unknown;
	};
	errorMessage?: string;
}

export interface IPostReceiveLimit {
	type: 'limit';
	enabled?: boolean | string;
	properties: {
		maxResults: number | string;
		[key: string]: unknown;
	};
	errorMessage?: string;
}

export interface IPostReceiveRootProperty {
	type: 'rootProperty';
	enabled?: boolean | string;
	properties: {
		property: string;
		[key: string]: unknown;
	};
	errorMessage?: string;
}

export interface IPostReceiveSet {
	type: 'set';
	enabled?: boolean | string;
	properties: {
		value: string;
		[key: string]: unknown;
	};
	errorMessage?: string;
}

export interface IPostReceiveSetKeyValue {
	type: 'setKeyValue';
	enabled?: boolean | string;
	properties: Record<string, string | number>;
	errorMessage?: string;
}

export interface IPostReceiveSort {
	type: 'sort';
	enabled?: boolean | string;
	properties: {
		key: string;
		[key: string]: unknown;
	};
	errorMessage?: string;
}

export type PostReceiveAction =
	| ((
			this: IExecuteSingleFunctions,
			items: INodeExecutionData[],
			response: IN8nHttpFullResponse,
	  ) => Promise<INodeExecutionData[]>)
	| IPostReceiveBinaryData
	| IPostReceiveFilter
	| IPostReceiveLimit
	| IPostReceiveRootProperty
	| IPostReceiveSet
	| IPostReceiveSetKeyValue
	| IPostReceiveSort;

export interface INodeRequestOutput {
	maxResults: number | string;
	postReceive: PostReceiveAction[];
}

export interface INodeRequestSend {
	preSend: PreSendAction[];
	paginate?: boolean | string;
	property?: string;
	propertyInDotNotation?: boolean;
	type: 'body' | 'query';
	value?: string;
}

export interface IRequestOptionsSimplifiedAuth {
	auth?: {
		username: string;
		password: string;
		sendImmediately?: boolean;
	};
	body?: Record<string, unknown>;
	headers?: IDataObject;
	qs?: IDataObject;
	url?: string;
	skipSslCertificateValidation?: boolean | string;
}

export interface IN8nRequestOperationPaginationGeneric {
	type: 'generic';
	properties: {
		continue: boolean | string;
		request: IRequestOptionsSimplifiedAuth;
		[key: string]: unknown;
	};
}

export interface IN8nRequestOperationPaginationOffset {
	type: 'offset';
	properties: {
		limitParameter: string;
		offsetParameter: string;
		pageSize: number;
		rootProperty?: string;
		type: 'body' | 'query';
		[key: string]: unknown;
	};
}

export declare namespace DeclarativeRestApiSettings {
	export type HttpRequestOptions = {
		[key: string]: unknown;
	};

	export type ResultOptions = {
		maxResults?: number | string;
		options: HttpRequestOptions;
		paginate?: boolean | string;
		preSend: PreSendAction[];
		postReceive: Array<{
			data: {
				parameterValue: string | IDataObject | undefined;
			};
			actions: PostReceiveAction[];
		}>;
		requestOperations?: IN8nRequestOperations;
	};
}

export interface IN8nRequestOperations {
	pagination?:
		| IN8nRequestOperationPaginationGeneric
		| IN8nRequestOperationPaginationOffset
		| ((
				this: IExecutePaginationFunctions,
				requestOptions: DeclarativeRestApiSettings.ResultOptions,
		  ) => Promise<INodeExecutionData[]>);
}

export interface INodePropertyRouting {
	operations?: IN8nRequestOperations;
	output?: INodeRequestOutput;
	request?: DeclarativeRestApiSettings.HttpRequestOptions;
	send?: INodeRequestSend;
}
