# seat.njtech.edu.cn GraphQL API 清单

来源：应用 JS bundle（/web/static/js/*.js），以下为完整 GraphQL 语句清单。

调用方式：POST /index.php/graphql/，body = {operationName, query, variables}，认证靠会话 Cookie（Authorization JWT + wechatSESS_ID）。


## 主 bundle

### advertLink (query)

```graphql
query advertLink($type: String!) {
  userAuth {
    user {
      advertLink(type: $type)
    }
  }
}
```


## 首页 chunk

### index (query)

首页聚合查询（2026-08-15 实测）：当前预约 `reserve.reserve` + 退座凭证 `getSToken`。
退座时把 `getSToken` 值作为 `reserveCancle` 的 `sToken`（与前端退座按钮行为一致，实测有效）。
`getSToken` 每次查询返回新值，退座成功后仍返回（会话级动态 token，与是否有预约无关）；
判断"无进行中预约"以 `reserve.reserve == null` 为准。

```graphql
query index($pos: String!, $param: [hash]) {
  userAuth {
    oftenseat {
      list {
        id
        info
        lib_id
        seat_key
        status
      }
    }
    message {
      new(from: "system") {
        has
        from_user
        title
        num
      }
      indexMsg {
        message_id
        title
        content
        isread
        isused
        from_user
        create_time
      }
    }
    reserve {
      reserve {
        token
        status
        user_id
        user_nick
        sch_name
        lib_id
        lib_name
        lib_floor
        seat_key
        seat_name
        date
        exp_date
        exp_date_str
        validate_date
        hold_date
        diff
        diff_str
        mark_source
        isRecordUser
        isChooseSeat
        isRecord
        mistakeNum
        openTime
        threshold
        daynum
        mistakeNum
        closeTime
        timerange
        forbidQrValid
        renewTimeNext
        forbidRenewTime
        forbidWechatCancle
      }
      getSToken
    }
    currentUser {
      user_id
      user_nick
      user_mobile
      user_sex
      user_sch_id
      user_sch
      user_last_login
      user_avatar(size: MIDDLE)
      user_adate
      user_student_no
      user_student_name
      area_name
      user_deny {
        deny_deadline
      }
      sch {
        sch_id
        sch_name
        activityUrl
        isShowCommon
        isBusy
      }
      subscribe_remind
    }
    record {
      recordRegInfo {
        reg_start
        reg_end
      }
      recordShortlistInfo
    }
  }
  ad(pos: $pos, param: $param) {
    name
    pic
    url
  }
  homeIconAd: ad(pos: "home-icon", param: $param) {
    name
    pic
    url
  }
}
```

### captcha (query)

选座验证码（注意是**顶层字段**，不在 userAuth 下）。`data` 为图片（base64 data URI 或 URL），
`code` 是验证码 token，回传给选座 mutation 的 `captcha` 参数。空验证码选座被拒（错误码 1000）时才需要。

```graphql
query captcha {
  captcha {
    code
    data
  }
}
```

另：同 chunk 还有 `verifyCaptcha($captcha: String!, $code: String!)` mutation（注册/短信流程用）。

### blueDevices (query)

```graphql
query blueDevices {
  userAuth {
    reserve {
      blueDevices
    }
  }
}
```

### libSimple (query)

```graphql
query libSimple($libId: Int, $libType: Int) {
  userAuth {
    reserve {
      libs(libType: $libType, libId: $libId) {
        lib_id
        is_open
        lib_floor
        lib_name
        lib_type
      }
    }
  }
}
```

### libs (query)

```graphql
query libs($libId: Int, $libType: Int) {
  userAuth {
    reserve {
      libs(libType: $libType, libId: $libId) {
        lib_id
        is_open
        lib_floor
        lib_name
        lib_group_id
        lib_type
        lib_hold_reason
        lib_policy {
          open_week
          advance_booking
          open_time
          open_time_str
          close_time
          close_time_str
        }
      }
    }
  }
}
```

### libLayout (query)

```graphql
query libLayout($libId: Int, $libType: Int) {
  userAuth {
    reserve {
      libs(libType: $libType, libId: $libId) {
        lib_id
        is_open
        lib_floor
        lib_name
        lib_type
        lib_layout {
          seats_total
          seats_booking
          seats_used
          max_x
          max_y
          seats {
            x
            y
            key
            type
            name
            seat_status
            status
          }
        }
      }
    }
  }
}
```

### libRule (query)

```graphql
query libRule($libId: Int!) {
  userAuth {
    reserve {
      libRule(libId: $libId) {
        advance_booking
        lib_seat_ttl
        lib_hold_ttl
        lib_renew_time
        hold_reason
        close_start_date
        close_end_date
        open_time
        open_time_str
        close_time
        close_time_str
        lib_validate_time
      }
    }
  }
}
```

### list (query)

```graphql
query list {
  userAuth {
    reserve {
      libs(libType: -1) {
        lib_id
        lib_floor
        is_open
        lib_name
        lib_type
        lib_group_id
        lib_comment
        lib_rt {
          seats_total
          seats_used
          seats_booking
          seats_has
          reserve_ttl
          open_time
          open_time_str
          close_time
          close_time_str
          advance_booking
        }
      }
      libGroups {
        id
        group_name
      }
      reserve {
        isRecordUser
      }
    }
    record {
      libs {
        lib_id
        lib_floor
        is_open
        lib_name
        lib_type
        lib_group_id
        lib_comment
        lib_color_name
        lib_rt {
          seats_total
          seats_used
          seats_booking
          seats_has
          reserve_ttl
          open_time
          open_time_str
          close_time
          close_time_str
          advance_booking
        }
      }
    }
    rule {
      signRule
    }
  }
}
```

### recordRegInfo (query)

```graphql
query recordRegInfo {
  userAuth {
    record {
      recordRegInfo {
        reg_start
        reg_end
        reg_info
        reg_already
      }
      recordShortlistInfo
    }
  }
}
```

### reserveSeat (mutation)

```graphql
mutation reserveSeat($libId: Int!, $seatKey: String!, $captchaCode: String, $captcha: String!) {
  userAuth {
    reserve {
      reserveSeat(
        libId: $libId
        seatKey: $seatKey
        captchaCode: $captchaCode
        captcha: $captcha
      )
    }
  }
}
```

### reserueSeat (mutation)

```graphql
mutation reserueSeat($libId: Int!, $seatKey: String!, $captchaCode: String, $captcha: String!) {
  userAuth {
    reserve {
      reserueSeat(
        libId: $libId
        seatKey: $seatKey
        captchaCode: $captchaCode
        captcha: $captcha
      )
    }
  }
}
```

### blueSign (mutation)

```graphql
mutation blueSign($devices: String!) {
  userAuth {
    reserve {
      blueSign(devices: $devices)
    }
  }
}
```

### recordSettingSeat (mutation)

```graphql
mutation recordSettingSeat($libId: String!, $seatKey: String!) {
  userAuth {
    record {
      recordSettingSeat(libId: $libId, seatKey: $seatKey)
    }
  }
}
```

### recordReg (mutation)

```graphql
mutation recordReg {
  userAuth {
    record {
      recordReg
    }
  }
}
```

### recordRegCancel (mutation)

```graphql
mutation recordRegCancel {
  userAuth {
    record {
      recordRegCancel
    }
  }
}
```

### recordShortlist (mutation)

```graphql
mutation recordShortlist {
  userAuth {
    record {
      recordShortlist
    }
  }
}
```

### getCurrentUser (query)

```graphql
query getCurrentUser {
  userAuth {
    currentUser {
      user_id
      user_nick
      user_mobile
      user_sex
      user_sch_id
      user_sch
      user_last_login
      user_avatar(size: MIDDLE)
      user_adate
      user_student_no
      user_student_name
      area_name
      user_deny {
        deny_deadline
      }
      sch {
        sch_id
        sch_name
        activityUrl
        isShowCommon
      }
    }
  }
}
```

### oftenseat (query)

```graphql
query oftenseat {
  userAuth {
    oftenseat {
      list {
        id
        info
        lib_id
        seat_key
        status
      }
    }
  }
}
```

### new (query)

```graphql
query new {
  userAuth {
    message {
      new {
        has
      }
    }
  }
}
```

### ad (query)

```graphql
query ad($pos: String!, $param: [hash]) {
  ad(pos: $pos, param: $param) {
    name
    pic
    url
  }
}
```

### reserve (query)

```graphql
query reserve {
  userAuth {
    reserve {
      reserve {
        status
      }
    }
  }
}
```

### prereserveCheckMsg (query)

```graphql
query prereserveCheckMsg {
  userAuth {
    prereserve {
      prereserveCheckMsg
    }
  }
}
```

### reserveHold (mutation)

```graphql
mutation reserveHold {
  userAuth {
    reserve {
      reserveHold
    }
  }
}
```

### reserveHoldCancle (mutation)

```graphql
mutation reserveHoldCancle {
  userAuth {
    reserve {
      reserveHoldCancle
    }
  }
}
```

### reserveMarkCancle (mutation)

```graphql
mutation reserveMarkCancle {
  userAuth {
    reserve {
      reserveMarkCancle
    }
  }
}
```

### reserveCancle (mutation)

```graphql
mutation reserveCancle($sToken: String!) {
  userAuth {
    reserve {
      reserveCancle(sToken: $sToken) {
        timerange
        img
        hours
        mins
        per
      }
    }
  }
}
```

### reserveHoldConfirm (mutation)

```graphql
mutation reserveHoldConfirm {
  userAuth {
    reserve {
      reserveHoldConfirm
    }
  }
}
```

### setIndexMsgReaded (mutation)

```graphql
mutation setIndexMsgReaded($once: Boolean!) {
  userAuth {
    message {
      setIndexMsgReaded(once: $once)
    }
  }
}
```


## 个人页 chunk

### rank (query)

```graphql
query rank($type: String!) {
  userAuth {
    user {
      rank(type: $type) {
        rank
        timerange
        list {
          rank
          user_name
          user_avatar
          sch_name
          timerange
        }
      }
    }
  }
}
```

### tongJi (query)

```graphql
query tongJi {
  userAuth {
    tongJi {
      rank
      allTime
      dayTime
    }
  }
}
```

### unbind (mutation)

```graphql
mutation unbind {
  userAuth {
    user {
      unbind
    }
  }
}
```
