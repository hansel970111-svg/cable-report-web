# 网页版部署说明

这个项目可以部署成一个网页服务。朋友只需要打开你的公网网址，就能上传 Excel、预览数据、生成 PDF。

## 推荐方式

使用任何支持 Docker 的云平台或服务器部署本项目。项目已经包含：

- `Dockerfile`
- `.dockerignore`
- 运行所需 Node.js 依赖
- 运行所需 Python PDF 依赖

## 本地 Docker 测试

```bash
docker build -t cable-report-web .
docker run --rm -p 5000:5000 cable-report-web
```

然后打开：

```text
http://localhost:5000
```

## 部署到云平台

在云平台中选择 Docker 部署，配置：

```text
Build command: docker build -t cable-report-web .
Start command: docker run -p 5000:5000 cable-report-web
Port: 5000
```

如果平台自动识别 `Dockerfile`，通常不需要手动填写构建命令，只需要指定服务端口为 `5000`。

## 注意事项

- 公开网页会允许别人上传 Excel 并生成 PDF，正式分享前最好只发给可信的人。
- 如果多人同时大量生成 PDF，需要选择内存稍大的服务器。
- 当前生成的 PDF 会通过浏览器下载返回；服务器上的临时文件会自动清理。
