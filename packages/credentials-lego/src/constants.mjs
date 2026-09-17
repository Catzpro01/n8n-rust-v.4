export const CREDENTIAL_BLANKING_VALUE =
	'__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6';

export const CREDENTIAL_EMPTY_VALUE =
	'__n8n_EMPTY_VALUE_7b1af746-3729-4c60-9b9b-e08eb29e58da';

export const CREDENTIAL_ERRORS = {
	NO_DATA: 'No data is set on this credentials.',
	DECRYPTION_FAILED:
		'Credentials could not be decrypted. The likely reason is that a different "encryptionKey" was used to encrypt the data.',
	INVALID_JSON: 'Decrypted credentials data is not valid JSON.',
	INVALID_DATA: 'Credentials data is not in a valid format.',
};
