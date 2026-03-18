import type {
  RemoteCommandNameFromSchema,
  RemoteCommandParamsByName,
} from "@/contracts/remoteCommandSchemas";

export type RemoteCommandParamsMap = RemoteCommandParamsByName;

export type RemoteCommandName = RemoteCommandNameFromSchema;

export type RemoteCommandParams<TCommand extends RemoteCommandName> = RemoteCommandParamsMap[TCommand];
