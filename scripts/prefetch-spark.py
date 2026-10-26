"""Download the S3A connector for s3-pyspark-demo.ipynb into Spark's Ivy cache (~/.ivy2*/).

Run once at setup (make setup-spark, the Codespaces container, Binder's postBuild), so the
notebook's Spark session starts from the cache instead of downloading ~670 MB from Maven Central.
"""

import os

from pyspark.sql import SparkSession

HADOOP_AWS = "org.apache.hadoop:hadoop-aws:3.5.0"   # keep in step with s3-pyspark-demo.ipynb

os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")
spark = (SparkSession.builder.master("local[1]").appName("prefetch-s3a")
         .config("spark.ui.enabled", "false")
         .config("spark.jars.packages", HADOOP_AWS)
         .getOrCreate())
spark.stop()
print(f"Cached {HADOOP_AWS} and its dependencies for Spark {spark.version}")
