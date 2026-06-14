# -*- coding: utf-8 -*-
import os
import json
import uuid
import logging
import sseclient
import requests
import json
import sys



from pathlib import Path

import requests
from qcloud_cos import CosConfig, CosS3Client
from tencentcloud.common.common_client import CommonClient
from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile




# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def chat_sse(request_data: dict, sse_url: str) -> None:
    """
    通过 SSE 协议与对话服务进行交互（V2协议）。

    :param request_data: 发送到对话服务的请求数据。
    :param sse_url: SSE 服务的 URL。
    """
    logging.info("\n ========== Start Chat ========== \n")
    logging.info(f'SSE Request Data: {request_data}')

    response = requests.post(sse_url, data=json.dumps(request_data), stream=True, headers={"Accept": "text/event-stream", "Content-Type": "application/json"})
    client = sseclient.SSEClient(response)

    full_text = ""
    for event in client.events():
        if event.data == "[DONE]":
            logging.info("\n========== 对话完成 ========== \n")
            break
            
        data = json.loads(event.data)
        event_type = data.get("Type", "")
        
        if event.event == "request_ack":
            # 请求确认事件
            logging.info(f'[请求确认] Event: {event.event}')
            request_ack = data.get("RequestAck", {})
            status = request_ack.get("Status", "")
            if status != "success":
                logging.error(f"请求失败: {request_ack.get('StatusDesc', '')}")
                return
        elif event.event == "response.created":
            # 响应创建事件
            logging.info(f'[响应创建] RecordId: {data.get("Response", {}).get("RecordId", "")}')
        elif event.event == "response.processing":
            # 响应处理中事件
            response_data = data.get("Response", {})
            status_desc = response_data.get("StatusDesc", "")
            if status_desc:
                logging.info(f'[响应处理中] {status_desc}')
        elif event.event == "message.added":
            # 消息添加事件
            message = data.get("Message", {})
            logging.info(f'[消息添加] MessageId: {message.get("MessageId", "")}, Type: {message.get("Type", "")}')
        elif event.event == "content.added":
            # 内容添加事件
            content = data.get("Content", {})
            logging.info(f'[内容添加] Type: {content.get("Type", "")}')
        elif event.event == "text.delta":
            # 文本增量事件
            text = data.get("Text", "")
            full_text += text
            print(text, end="", flush=True)
        elif event.event == "message.done":
            # 消息完成事件
            message = data.get("Message", {})
            logging.info(f'\n[消息完成] Status: {message.get("Status", "")}, StatusDesc: {message.get("StatusDesc", "")}')
            contents = message.get("Contents", [])
            for content in contents:
                if content.get("Type") == "text":
                    logging.info(f'完整文本: {content.get("Text", "")}')
        elif event.event == "response.completed":
            # 响应完成事件
            response_data = data.get("Response", {})
            logging.info(f'[响应完成] Status: {response_data.get("Status", "")}, StatusDesc: {response_data.get("StatusDesc", "")}')
            stat_info = response_data.get("StatInfo", {})
            if stat_info:
                logging.info(f'Token统计 - 输入: {stat_info.get("InputTokens", 0)}, 输出: {stat_info.get("OutputTokens", 0)}, 总计: {stat_info.get("TotalTokens", 0)}')
        elif event.event == "error":
            # 错误事件
            logging.error(f'[错误] Event: {event.event}, Data: {event.data}')
        else:
            logging.info(f'[其他事件] Event: {event.event}, Data: {event.data}')





def document_parse(request_data: dict) -> tuple:
    """
    实时文档解析。

    :param request_data: 发送到文档解析服务的请求数据。
    :return: 文档 ID、状态和错误信息。
    """
    headers = {'Content-Type': 'application/json'}
    response = requests.post(DocParseUrl, data=json.dumps(request_data), headers=headers)
    response.raise_for_status()

    content_str = response.content.decode('utf-8')
    client = sseclient.SSEClient(response)
    for event in client.events():
        data = json.loads(event.data)
        doc_id = data['payload']['doc_id']
        status = data['payload']['status']
        error_message = data['payload']['error_message']
        is_final = data['payload']['is_final']

        if is_final:
            logging.info(f"Document ID: {doc_id}")
            return doc_id, status, error_message
        else:
            logging.info(data)


def get_temporary_credentials(bot_biz_id: str, file_type: str, is_public: bool, type_key: str) -> dict:
    """
    获取临时密钥。

    :param bot_biz_id: 业务 ID。
    :param file_type: 文件类型。
    :param is_public: 是否公开。
    :param type_key: 类型键。
    :return: 临时密钥相关数据。
    """
    try:
        cred = credential.Credential(SecretID, SecretKey)
        http_profile = HttpProfile()
        http_profile.endpoint = EndPoint
        client_profile = ClientProfile()
        client_profile.httpProfile = http_profile

        params = {
            "BotBizId": bot_biz_id,
            "FileType": file_type,
            "TypeKey": type_key,
            "IsPublic": is_public
        }
        common_client = CommonClient("lke", "2023-11-30", cred, Region, profile=client_profile)
        response = common_client.call_json("DescribeStorageCredential", params)
        credentials = response['Response']['Credentials']
        upload_path = response['Response']['UploadPath']
        bucket = response['Response']['Bucket']
        region = response['Response']['Region']
        cos_type = response['Response']['Type']

        logging.info("======== DescribeStorageCredential Success =======")
        logging.info(f"Temporary Secret ID: {credentials['TmpSecretId']}")
        logging.info(f"Temporary Secret Key: {credentials['TmpSecretKey']}")
        logging.info(f"Token: {credentials['Token']}")
        logging.info(f"Upload Path: {upload_path}")
        logging.info(f"Bucket: {bucket}")
        logging.info(f"Region: {region}")
        logging.info(f"Type: {cos_type}")

        return {
            "TmpSecretId": credentials['TmpSecretId'],
            "TmpSecretKey": credentials['TmpSecretKey'],
            "Token": credentials['Token'],
            "UploadPath": upload_path,
            "Bucket": bucket,
            "Region": region,
            "Type": cos_type
        }
    except Exception as err:
        logging.error(err)
        raise


def upload_file_to_cos(file_path: str, credentials: dict) -> dict:
    """
    将文件上传到 COS。

    :param file_path: 文件路径。
    :param credentials: 临时密钥相关数据。
    :return: 文件的 COS URL。
    """
    config = CosConfig(
        Region=credentials['Region'],
        SecretId=credentials['TmpSecretId'],
        SecretKey=credentials['TmpSecretKey'],
        Token=credentials['Token'],
        Scheme='https'
    )
    client = CosS3Client(config)

    file_name = Path(file_path).name
    response = client.upload_file(
        Bucket=credentials['Bucket'],
        Key=credentials['UploadPath'],
        LocalFilePath=file_name,
        EnableMD5=False,
        progress_callback=None
    )

    logging.info(f"Upload Result: {response}")
    e_tag = response.get('ETag')
    cos_hash = response.get('x-cos-hash-crc64ecma')
    logging.info(f"ETag: {e_tag}, COS Hash: {cos_hash}")

    bucket_url = f"https://{credentials['Bucket']}.{credentials['Type']}.{credentials['Region']}.myqcloud.com"
    cos_final_url = f"{bucket_url}{credentials['UploadPath']}"
    logging.info(f"File URL: {cos_final_url}")
    return {
        "cos_final_url": cos_final_url,
        "e_tag": e_tag,
        "cos_hash": cos_hash
    }



if __name__ == "__main__":

    Region = "ap-guangzhou"
    EndPoint = "lke.tencentcloudapi.com"
    SecretID = ""
    SecretKey = ""
    BotBizID = ""             # BotBizID 是创建某个应用时的唯一标识,如果不知道如何获取请参考：https://cloud.tencent.com/document/product/1759/109469 第三项
    BotAppKey = ""            # 是分享或者通过 websocket , sse HTTP 调用的时候用来获取访问通证的一个参数,如果不知道如何获取请参考：https://cloud.tencent.com/document/product/1759/109469 第三项
    TypeKeyRealtime = "realtime"
    DocParseUrl = "https://wss.lke.cloud.tencent.com/v1/qbot/chat/docParse"
    SSEUrl      = "https://wss.lke.cloud.tencent.com/adp/v2/chat"


    # 请使用 python 3.9，使用前需要安装依赖: pip3 install -r requirements.txt<br>
    # 图片路径
    file_path = "./小楷.jpeg"
    # 文件路径
    # file_path = "./致橡树.txt"
    file_name = Path(file_path).name
    file_ext = Path(file_path).suffix[1:]
    file_size = str(os.path.getsize(file_path))

    logging.info(f"File Path: {file_path}")
    logging.info(f"File Name: {file_name}")
    logging.info(f"File Extension: {file_ext}")
    logging.info(f"File Size: {file_size}")


    # 临时密钥的获取，请注意，参数组合不同得到的临时密钥权限不同，会影响后面上传cos和文件解析的结果。常见问题如： 上传cos报错403， 实时文档解析报错 Invalid-URL
	# 可参考 https://cloud.tencent.com/document/product/1759/116238 的参数组合，或者在遇到需要上传文件的地方F12抓包DescribeStorageCredential接口，看下参数组合
    # 请注意，该场景为对话接口上传，is_public做了特殊判断，其他场景请参考上上面文档确定图片是否需要特殊处理
    # 请注意，对话是上传图片和知识库上传图片限制的图片格式和大小随着产品能力的迭代会增加或者扩大，请参考知识引擎页面调整图片的支持范围
    is_public = file_ext.lower() in ["jpg", "jpeg", "png", "bmp"]
    credentials = get_temporary_credentials(BotBizID, file_ext, is_public, TypeKeyRealtime)

    # 上传文件到 COS
    # 请注意，需要使用临时密钥建立cos_clint, 不同的语言方式不一样，使用其他语言可自行参考cos的sdk
    # 目前已知至少包含三个参数【secret_key,secret_id,token】, 该参数请从获取临时密钥接口返回的数据中获取
    cos_result = upload_file_to_cos(file_path, credentials)
    logging.info(f"Cos Result: {cos_result}")

    # 生成会话 ID
   # session_id很重要，请遵循规则生成，docParse传入的session_id需和对话时传入的session_id保持一致
    session_id = str(uuid.uuid4())

    if file_ext.lower() in ["jpg", "jpeg", "png", "bmp"]:
        # 图片处理逻辑, 图片的类型和大小限制的扩充，请关注知识引擎发版公告或者页面上的限制
        content = "请描述这张图片"
        request_data = {
            "RequestId": session_id,
            "ConversationId": session_id,
            "AppKey": BotAppKey,
            "VisitorBizId": session_id,
            "Contents": [
                {
                    "Type": "text",
                    "Text": content
                },
                {
                    "Type": "image",
                    "Image": {
                        "Url": cos_result['cos_final_url']
                    }
                }
            ],
            "Stream": "enable"
        }
        chat_sse(request_data, SSEUrl)
    else:
         # 文档处理逻辑
        try:
            request_data = {
                "session_id": session_id,
                "request_id": session_id,
                "cos_bucket": credentials['Bucket'],
                "file_type": file_ext,
                "file_name": file_name,
                "cos_url": credentials['UploadPath'],
                "e_tag": cos_result["e_tag"],   
                "cos_hash": cos_result["cos_hash"],   
                "size": file_size,
                "bot_app_key": BotAppKey,
            }
            logging.info(f"Document Parse Request Data: {request_data}")
            doc_id, status, error_message = document_parse(request_data)
            if status == "FAILED":
                logging.error(f"Document Parse Failed! Status: {status}, Error Message: {error_message}")
                exit()

            sse_request_data = {
                "RequestId": session_id,
                "ConversationId": session_id,
                "AppKey": BotAppKey,
                "VisitorBizId": session_id,
                "Contents": [
                    {
                        "Type": "file",
                        "File": {
                            "FileName": file_name,
                            "FileSize": file_size,
                            "FileUrl": cos_result["cos_final_url"],
                            "FileType": file_ext,
                            "DocBizId": doc_id
                        }
                    }
                ],
                "Stream": "enable"
            }
            chat_sse(sse_request_data, SSEUrl)

        except requests.exceptions.RequestException as e:
            logging.error(e)