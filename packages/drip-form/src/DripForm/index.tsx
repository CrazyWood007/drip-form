/*
 * @Author: jiangxiaowei
 * @Date: 2020-05-14 16:54:32
 * @Last Modified by: jiangxiaowei
 * @Last Modified time: 2022-04-18 17:30:53
 */
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import produce from 'immer'
import { useImmerReducer } from 'use-immer'
import './index.styl'
// 配置与工具
import validate from '../validate'
import formDataReducer, { FormDataContext } from '../reducers'
import renderCoreFn from '../render'
import Tooltip from 'react-tooltip'
import { typeCheck, parseUnitedSchema, randomString } from '@jdfed/utils'
import {
  useValidate,
  useSchema,
  useGetKey,
  usePrevious,
  RequiredModeContext,
} from '@jdfed/hooks'
import containerMap from '../container'
import Footer from './Footer'
import type { DripFormRenderProps, DripFormRefType, ControlFuc } from './type'
import type { State, Action, Theme, UiSchema } from '@jdfed/utils'

/**
 * 表单入口
 */
const DripForm = forwardRef<DripFormRefType, DripFormRenderProps>(
  (
    {
      formData: initFormData = {},
      unitedSchema,
      ajv,
      uiComponents,
      customComponents,
      customFunc,
      control,
      onValidate = {},
      onQuery,
      transform,
      containerHoc,
      onSubmit,
      onCancel,
      parse,
      reload = true,
    },
    ref
  ) => {
    const prevUnitedSchema = usePrevious(unitedSchema)
    const prevFormData = usePrevious(initFormData)
    const parseFormData = useMemo(() => {
      // 判断是否需要触发转化函数
      if (
        parse &&
        typeof parse === 'function' &&
        prevFormData !== initFormData
      ) {
        const newFormData = parse(initFormData || {})
        // 确认返回值格式正确
        if (typeof newFormData !== 'object') {
          console.error('parse函数解析失败，请确认parse的返回值是一个对象！')
          return prevFormData
        } else {
          return newFormData
        }
      }
    }, [initFormData, parse, prevFormData])
    const {
      uiSchema: initUiSchema,
      dataSchema: initDataSchema,
      typePath: initTypePath,
      customProps,
    } = useMemo(() => {
      return parseUnitedSchema(unitedSchema)
    }, [unitedSchema])

    // 取随机数用于存储formData数据到全局，需要透传
    const globalFormDataStoreKey = useMemo<string>(() => {
      return randomString(12)
    }, [])

    // 递归uiSchema中properties中的各项
    const recursiveSchema = useCallback(
      (currSchema, schemaKey, schemaValue) => {
        if (typeCheck(schemaValue) === 'Object') {
          Object.keys(schemaValue).forEach((itemKey) => {
            recursiveSchema(schemaValue, itemKey, schemaValue[itemKey])
          })
        } else if (typeCheck(schemaValue) === 'Array') {
          schemaValue.forEach((itemValue: any, itemIdx: number) => {
            recursiveSchema(schemaValue, itemIdx, itemValue)
          })
        } else {
          // 如果uiSchema中配置项的值为string型，判断是否需要替换为自定义方法，以$$标识，格式为：$$customFunc
          if (typeCheck(schemaValue) === 'String') {
            const customFuncReg = /^\$\$/g
            const shouldUseFunc = schemaValue.match(customFuncReg)

            if (shouldUseFunc && shouldUseFunc.length > 0) {
              currSchema[schemaKey] =
                customFunc &&
                Object.prototype.hasOwnProperty.call(customFunc, schemaValue)
                  ? customFunc[schemaValue]
                  : (console.error(
                      `找不到与'${schemaValue}'对应的自定义方法，请检查'customFunc'`
                    ),
                    schemaValue)
            }
          }
        }
      },
      [customFunc]
    )

    // 预处理uiSchema，将 $$xx 关键字转化为自定义函数
    const memoUiSchema = useMemo(() => {
      return produce(initUiSchema, (draft) => {
        const properties = draft.properties ?? []
        Object.keys(properties).forEach((formKey) => {
          recursiveSchema(properties, formKey, properties[formKey])
        })
      })
    }, [initUiSchema, recursiveSchema])

    const initArgs = useMemo<State>(
      () => ({
        typePath: initTypePath,
        uiSchema: memoUiSchema,
        dataSchema: initDataSchema,
        formData:
          validate({
            schema: initDataSchema,
            formData: parseFormData || initFormData,
            ajv,
            customProps,
          }).formData || {},
        // ajv是否已经将dataSchema中的默认值添加到formData中
        hasDefault: false,
        // 下个版本废弃，改用ajvErros和customErrors
        errors: {},
        customErrors: {},
        ajvErrors: {},
        // 表单是否在校验中
        checking: false,
        // 当前展示（已加载）的组件。用来优化校验逻辑（隐藏表单不校验)
        visibleFieldKey: [],
        changeKey: '',
        arrayKey: {},
        ignoreErrKey: [],
      }),
      [
        initTypePath,
        memoUiSchema,
        initDataSchema,
        parseFormData,
        initFormData,
        ajv,
        customProps,
      ]
    )

    // visibleFieldKey为组件初次加载设置，reload不会触发组件卸载操作，只是重置数据
    const resetArgs = useMemo(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { visibleFieldKey, ...resetArgs } = initArgs
      return resetArgs
    }, [initArgs])

    const [data, dispatch] = useImmerReducer<State, Action>(
      formDataReducer,
      initArgs
    )

    // 重新初始化
    useEffect(() => {
      if (
        ((prevUnitedSchema && prevUnitedSchema != unitedSchema) ||
          (prevFormData &&
            Object.keys(prevFormData).length > 0 &&
            prevFormData !== initFormData)) &&
        reload
      ) {
        dispatch({
          type: 'reset',
          action: {
            state: resetArgs,
          },
        })
      }
    }, [
      dispatch,
      prevFormData,
      initFormData,
      initArgs,
      initDataSchema,
      parseFormData,
      initTypePath,
      initUiSchema,
      prevUnitedSchema,
      unitedSchema,
      reload,
      resetArgs,
    ])

    const {
      typePath,
      uiSchema,
      dataSchema,
      formData,
      ajvErrors,
      customErrors,
      checking,
      hasDefault,
      visibleFieldKey,
      changeKey,
      arrayKey,
    } = data

    // 错误信息（ajv错误+用户自定义错误）
    const errors = useMemo(() => {
      const errors = { ...ajvErrors, ...data.errors }
      Object.entries(customErrors).map(([key, item]) => {
        if (Object.prototype.hasOwnProperty.call(errors, key)) {
          errors[key] = `${errors[key]}；${item}`
        } else {
          errors[key] = item
        }
      })
      return errors
    }, [ajvErrors, customErrors, data.errors])

    const { theme = 'antd', change } = uiSchema as UiSchema & {
      change: string | ControlFuc
    }

    useEffect(() => {
      // 当前值为暂时获取其他表单数据，后续会更新获取方法
      ;(window as any)[globalFormDataStoreKey] = formData
    }, [globalFormDataStoreKey, formData])

    // 实时校验
    const validateDebounce = useValidate(validate)

    // dispatch setFormData、setUiSchema、setDataSchema 语法糖
    const { get, set, deleteField, addField, merge } = useSchema({
      dataSchema,
      uiSchema,
      typeMap: typePath,
      dispatch,
      formData,
    })

    // 获取当前fieldKey相对uiSchema、dataSchema路径
    const { getKey } = useGetKey(typePath)

    // 用于获取实时的submit的返回值
    const submitReturn = useRef({
      formData,
      errors,
      checking,
    })

    useEffect(() => {
      submitReturn.current = {
        formData: produce(formData, (draft) => {
          transform && transform(draft)
        }),
        errors,
        checking,
      }
    }, [checking, errors, formData, transform])

    // 提交表单
    const submit = useCallback<DripFormRefType['submit']>(() => {
      const onValidateResMap: Record<string, any> = {}
      Object.entries(onValidate).map(([key, value]) => {
        if (value.type === 'submit') {
          onValidateResMap[key] = new Promise((resolve) => {
            resolve(value.fn(get(key).data as any))
          })
        }
      })
      const fieldKeys = Object.keys(onValidateResMap)
      return Promise.all(Object.values(onValidateResMap))
        .then((res) => {
          const checkTrueFieldKey: string[] = []
          const setErrObj: Record<string, any> = {}
          res.map((val, i) => {
            if (val) {
              setErrObj[fieldKeys[i]] = val
            } else {
              checkTrueFieldKey.push(fieldKeys[i])
              return false
            }
          })
          dispatch({
            type: 'setErr',
            action: {
              set: setErrObj,
            },
          })
          dispatch({
            type: 'setErr',
            action: {
              deleteKeys: checkTrueFieldKey,
            },
          })
        })
        .then(() => {
          return submitReturn.current
        })
    }, [dispatch, get, onValidate])

    // 重置表单
    const reset = useCallback(() => {
      dispatch({
        type: 'reset',
        action: {
          state: resetArgs,
        },
      })
    }, [dispatch, resetArgs])

    // 向外抛出表单数据
    useImperativeHandle<DripFormRefType, DripFormRefType>(
      ref,
      () => ({
        errors,
        checking,
        submit,
        reset,
        dispatch,
        get,
        set,
        merge,
        getKey,
        // 适用于生成器的
        __generator__: {
          deleteField,
          addField,
        },
        get formData() {
          // 在用户取值时判断是否需要触发transform，并返回formData的一个拷贝
          return produce(formData, (draft) => {
            transform && transform(draft)
          })
        },
      }),
      [
        addField,
        checking,
        deleteField,
        dispatch,
        errors,
        formData,
        get,
        getKey,
        merge,
        reset,
        set,
        submit,
        transform,
      ]
    )

    useEffect(() => {
      validateDebounce({
        dataSchema,
        formData,
        ajv,
        dispatch,
        visibleFieldKey,
      })
    }, [dataSchema, formData, validateDebounce, dispatch, visibleFieldKey, ajv])

    // 最高等级 表单联动控制逻辑
    useEffect(() => {
      if (control) {
        try {
          control({
            formData,
            uiSchema,
            dataSchema,
            dispatch,
            changeKey,
            checking,
            get,
            set,
            merge,
            deleteField,
          })
        } catch (error) {
          console.error(error)
        }
      }
      if (change) {
        let changeFn
        try {
          if (typeof change === 'function') {
            changeFn = change
          } else if (typeof change === 'string') {
            changeFn = new Function('props', change as string)
          }

          if (changeFn) {
            changeFn({
              formData,
              uiSchema,
              dataSchema,
              dispatch,
              changeKey,
              checking,
              get,
              set,
              merge,
              deleteField,
            })
          }
        } catch (error) {
          console.error('change函数体错误，请确认')
          console.error(error)
        }
      }
    }, [
      control,
      dataSchema,
      dispatch,
      formData,
      uiSchema,
      changeKey,
      checking,
      get,
      set,
      merge,
      deleteField,
      change,
    ])
    const globalTheme: Theme = theme

    return (
      <RequiredModeContext.Provider
        value={dataSchema?.requiredMode || 'default'}
      >
        <FormDataContext.Provider value={globalFormDataStoreKey}>
          <div className={'drip-form-root'}>
            {renderCoreFn({
              hasDefault,
              uiComponents,
              dataSchema,
              uiSchema,
              errors,
              formData,
              onQuery,
              onValidate,
              dispatch,
              customComponents,
              containerMap,
              getKey,
              get,
              containerHoc,
              arrayKey,
              isRoot: true,
            })}
            <Tooltip clickable={true} />
            <Footer
              uiSchema={uiSchema}
              uiComponents={uiComponents}
              onSubmit={onSubmit}
              submit={submit}
              submitReturn={submitReturn}
              onCancel={onCancel}
              globalTheme={globalTheme}
              initFormData={initArgs.formData}
              dispatch={dispatch}
            />
          </div>
        </FormDataContext.Provider>
      </RequiredModeContext.Provider>
    )
  }
)

DripForm.defaultProps = {
  onValidate: {},
  onQuery: {},
}

DripForm.displayName = 'DripForm'

const memoDripForm = memo(DripForm)

export default memoDripForm
